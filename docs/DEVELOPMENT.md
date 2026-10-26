# V0 開發約定

## 1. 規格優先順序

V0 以 `V0_IMPLEMENTATION_SPEC.md` 為當前實作依據。`SYSTEM_SPEC.md` 保留為未來 V1 擴充參考，不得用它把 PostgreSQL、Push 或複雜 recovery 加回 V0。

## 2. 環境分層

| 環境 | 用途 | 網路規則 |
|---|---|---|
| local | workflow 與 validation 開發 | 不啟用 Funnel，不連正式 LINE Channel |
| staging | LINE Webhook 與 Gemini 整合測試 | 使用測試 Channel、測試 credential 與測試 Data Table |
| production | 單一允許使用者 | 只公開 exact webhook path，workflow concurrency 為 1 |

local/staging 不可共用 production LINE credential、Gemini API key 或 n8n volume。

## 3. Secret 與身分資料

不得寫入 Git、`.env.example`、Gemini prompt 或 workflow export 的內容：

- LINE Channel Secret 與 Channel Access Token。
- Gemini API key。
- `N8N_ENCRYPTION_KEY`。
- production `line_user_id`。
- reply token、Authorization header 與 raw webhook body。
- verifier-to-n8n internal webhook token。

LINE Channel Secret、單一使用者 allowlist 與內部 Webhook token 分別放在 ignored 的 `secrets/line_channel_secret`、`secrets/line_owner_user_id`、`secrets/n8n_internal_webhook_token`，只掛載到 verifier container。內部 token 的另一份由 n8n Header Auth credential 加密保存。LINE Channel Access Token 與 Gemini API key 也使用 n8n Credentials 管理。這些值都不得來自 LINE 文字、postback、Gemini 輸出或 workflow export。

## 4. Data Table 規則

V0 只有一張 `tasks` Data Table。

- `task_id` 由已驗簽的 `webhookEventId` 衍生，不使用競爭性的自增流水號。
- 新增使用 `source_event_id` 與穩定 `task_id` upsert。
- 完成與取消必須同時篩選 `task_id` 與目前已驗證的 `line_user_id`。
- 重複完成或取消時，返回現有狀態，不產生新副作用。
- 每次查詢都必須限制 `line_user_id`，不可先讀全表再在 Code node 過濾。
- 因 Data Table 沒有 PostgreSQL 的 transaction/constraint 保證，V0 不宣稱嚴格 exactly-once。

## 5. Gemini 邊界

Gemini 只可輸出以下 intent：

```text
create_task
list_tasks
complete_task
cancel_task
help
unknown
```

n8n 在 Switch 前必須對 JSON 進行本機驗證：

- intent 必須在 allowlist。
- `create_task` 必須有非空 title 與合法 ISO 8601 `due_at`。
- `complete_task`/`cancel_task` 必須有合法 task ID。
- `needs_confirmation=true` 時禁止寫入。
- 不接受 Gemini 提供的 user ID、reply token、URL、method、headers 或 credential 名稱。
- Gemini 當機、timeout、JSON 無效或內容不合規時，回覆可重試或改用固定格式，不寫入 Data Table。

## 6. 固定指令優先

以下格式直接解析，不呼叫 Gemini：

```text
今天
明天
未完成
完成 T708EA4DEF782
取消 T708EA4DEF782
幫助
```

只有其他自然語言才交給 Gemini。

## 7. Workflow 匯出

- V0 檔名固定為 `V0-line-task-assistant.json`。
- 匯出前移除 credential ID、pinned production data 與 execution payload。
- 匯出前移除 workflow ID、version ID、webhook ID 與 Data Table instance ID；匯入後在目標環境重新綁定。
- LINE Reply URL 必須固定為 `https://api.line.me/v2/bot/message/reply`。
- Gemini 不能透過 Agent tool 直接執行 Data Table 或 HTTP Request node。
- V0 不得出現 Schedule Trigger、LINE Push endpoint 或任意外部 URL。

## 8. 完成定義

- 合法單一使用者可新增、查詢、完成與取消任務。
- 錯誤簽章與未授權使用者不會呼叫 Gemini 或存取 Data Table。
- 相同建立事件重送不會新增第二筆任務。
- 任何任務操作都有 `line_user_id` scope。
- 惡意或錯誤 Gemini 輸出無法改變收件人、endpoint 或任意操作。
- execution history、log 和 workflow export 不含 secret、raw body 或 reply token。
- n8n 重啟後 Data Table 仍存在。
- 公開面只有 `POST /webhook/line-events`，且只能到 verifier；n8n 內部 path 不經公開 proxy。
