# V0 實作規格：LINE + n8n + Gemini + Data Table

## 1. 目標

用最少元件建立可實際使用的單人 LINE 任務 chatbot，保留驗簽、授權、owner scope 與 AI 輸出驗證，延後主動通知與強一致性架構。

## 2. 架構

```text
LINE Messaging API
  → Tailscale Funnel（只在上線前啟用）
  → exact-path reverse proxy
  → LINE verifier sidecar
      ├─ raw-body HMAC-SHA256 驗簽
      ├─ 單一 owner allowlist 與事件清理
      └─ 加入 verifier-to-n8n internal token
  → n8n 內部 Webhook（Header Auth；不對外公開）
  → V0 workflow
      ├─ 固定指令解析
      ├─ Gemini structured output（只處理自然語言）
      ├─ n8n Data Table: tasks
      └─ LINE Reply API
```

## 3. 範圍

### 包含

- 新增有明確日期時間的任務。
- 查詢今天、明天與未完成任務。
- 使用明確 task ID 完成或取消任務。
- 幫助與無法辨識訊息。
- 全部使用 LINE Reply。

### 不包含

- LINE Push、定時提醒、日報與週報。
- Push quota、reservation 與 retry-key 對帳。
- 多使用者、群組、對話記憶與模糊參照。
- 任務修改、恢復、全天任務、附件、語音或圖片。
- PostgreSQL、SQL migration、fencing lease 與複雜 crash recovery。

## 4. `tasks` Data Table

| 欄位 | 類型 | 用途 |
|---|---|---|
| `task_id` | string | `T` 加已驗簽 `webhookEventId` 的 SHA-256 前 12 位大寫十六進位摘要，用戶可見 |
| `source_event_id` | string | 建立事件去重來源 |
| `line_user_id` | string | 任務 owner，只來自已驗簽 event source |
| `title` | string | 任務內容 |
| `due_at` | datetime | 到期時間；寫入前正規化為含時區的 ISO 8601 |
| `status` | string | `pending` / `completed` / `cancelled` |

n8n Data Table 會自動提供 `id`、`createdAt` 與 `updatedAt` 系統欄位；V0 直接使用這些欄位，不另外建立重複的 `created_at` / `updated_at`。

V0 將 workflow concurrency 設為 1，建立使用 upsert，完成與取消只對 `task_id + line_user_id` 篩選結果更新。

## 5. 結構化意圖

Gemini 的輸出契約：

```json
{
  "intent": "create_task",
  "task_id": null,
  "title": "交企劃書",
  "due_at": "2026-10-26T15:00:00+08:00",
  "query_range": null,
  "needs_confirmation": false,
  "question": null
}
```

允許的 intent：

```text
create_task
list_tasks
complete_task
cancel_task
help
unknown
```

驗證規則：

- 不在 allowlist 的 intent 轉為 `unknown`。
- `create_task` 缺 title/due_at、日期無效或時間已過時，禁止寫入。
- `complete_task`/`cancel_task` 缺 task ID 時，禁止寫入。
- `needs_confirmation=true` 時，只回覆 `question`，禁止寫入。
- 任何 schema 外的權限或網路欄位都忽略。
- `line_user_id`、event ID 與 reply token 只來自已驗簽的 LINE event，不來自 Gemini。

固定指令中的 task ID 格式為 `T` 加 12 位大寫十六進位，例如 `T708EA4DEF782`；輸入時可使用小寫，驗證後會正規化為大寫。

## 6. Workflow 步驟

1. exact-path proxy 只將 `POST /webhook/line-events` 的未改寫 body 送到 verifier。
2. verifier 從 Docker secret 取得 LINE Channel Secret，對 raw bytes 計算 HMAC-SHA256，並以 constant-time 方式比對 signature。
3. 驗簽失敗立即停止；JSON 不會被解析，也不會觸及 n8n、Gemini 或 Data Table。
4. verifier 只接受受保護 allowlist 中的單一 `line_user_id`、一對一文字訊息與 500 字元內文字。
5. verifier 只把必要的 sanitized fields 送到 n8n 內部 `line-events-internal` Webhook，並附上獨立的 `X-LNTA-Internal-Token`；n8n 在 workflow 入口先以 Header Auth 驗證。
6. n8n 再驗證 verifier envelope 與欄位格式，任何不符都 fail closed。
7. 先解析固定指令；只有其他自然語言才呼叫 Gemini。
8. `今天`、`明天`、`未完成` 使用 `line_user_id + pending` 在 Data Table 層查詢；日期使用台北時區半開區間，回覆前再核對 owner。
9. 對 Gemini JSON 執行本機 schema 與語意驗證。
10. 依驗證後的 mutation intent 執行 Data Table Upsert/Update。
11. 從受信任的 n8n 資料組合回覆，不使用 Gemini 提供的收件人或 endpoint。
12. 透過固定 `https://api.line.me/v2/bot/message/reply` 發送 Reply。

## 7. 安全與可靠性限制

- Data Table 不具備完整的交易、constraint 與 fencing 能力。V0 只適用於單使用者、低並行、無 Push 情境。
- 穩定 ID + upsert + concurrency 1 是實用的去重降風險措施，不等同嚴格 exactly-once。
- 加入 Push、多使用者、高並行或強可靠性需求前，必須重新評估 PostgreSQL 與原子 reservation。
- n8n volume 是 Data Table 的持久化邊界；需要備份 n8n volume，但 V0 先不實作自動加密備份流程。

## 8. 驗收條件

- 使用者能用 LINE 新增、查詢、完成與取消任務。
- 建立結果回顯 task ID、標題與絕對到期時間。
- 重送同一建立事件不會增加第二筆資料。
- 錯誤簽章、未授權使用者與跨使用者 task ID 不會產生資料副作用。
- Gemini 無效或惡意輸出無法繞過 intent、owner、endpoint 或 credential 邊界。
- n8n 重啟後 Data Table 資料仍存在。
- 只有 `POST /webhook/line-events` 從公開網際網路可達。
