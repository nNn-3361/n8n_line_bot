# LINE × n8n × Gemini 個人任務助理

> 專案介紹、使用說明與維運手冊
> 適用版本：V0 / repository version `0.1.0`
> 最後更新：2026-10-25（Asia/Taipei）

## 1. 專案是什麼

這是一個以 LINE 為操作介面的單人任務助理。使用者直接在 LINE 聊天室輸入固定指令或自然語言，系統會查詢、新增、完成或取消任務，並透過 LINE Reply 回覆結果。

V0 的設計重點不是讓 AI 直接控制系統，而是把 Gemini 限制在「理解自然語言、提出結構化 intent」的角色。所有身分、權限、日期、任務 ID、資料寫入與 LINE Reply 都由本機程式和 n8n 再次驗證。

目前適合：

- 單一指定 LINE 使用者。
- 個人、低流量的任務管理。
- 在自己的 Mac 上運行 n8n、Docker 與 Tailscale。
- 以明確日期和時間建立任務。

目前不包含：

- 定時提醒、逾期通知、日報或週報。
- LINE Push、廣播或群發。
- 多使用者、群組聊天或權限管理。
- 任務內容／時間修改、恢復或刪除。
- 對話記憶、模糊指代、全天任務、附件、語音或圖片。
- PostgreSQL、嚴格 exactly-once 或完整 disaster recovery。

## 2. 目前成品狀態

| 項目 | 狀態 |
|---|---|
| 自動測試 | 53/53 通過 |
| 真實 LINE `幫助` Reply | 通過，僅收到一則預期回覆 |
| 真實 LINE `今天` 查詢 | 通過 |
| 自然語言新增任務 | 通過 |
| `明天` 查回新增任務 | 通過 |
| 依任務 ID 取消 | 通過 |
| 取消後排除於待辦查詢 | 通過 |
| n8n | 已關閉；`lnta_n8n_data` volume 保留 |
| webhook proxy | 已關閉 |
| LINE verifier | 已關閉 |
| Tailscale Funnel | 已關閉，狀態為 `No serve config` |
| 本機 n8n workflow | 舊版曾發布並通過 smoke test；下次啟動前須加入 internal Header Auth 後重新發布 |
| repository workflow export | 29 個節點、`active=false`，不含 credential／workflow／version／webhook／Data Table instance ID |
| 服務日誌 | 僅記錄時間、status、method、path；未發現訊息或 Token |

目前公開 Webhook：

```text
https://<funnel-host>/webhook/line-events
```

n8n editor 只可從本機開啟：

```text
http://localhost:5678
```

## 3. 日常使用方式

### 3.1 固定指令

固定指令不會呼叫 Gemini。

| 輸入 | 用途 | 是否寫入資料 |
|---|---|---|
| `今天` | 查詢今天尚未完成的任務 | 否 |
| `明天` | 查詢明天尚未完成的任務 | 否 |
| `未完成` | 查詢最多 50 筆待辦，依時間排序 | 否 |
| `完成 TXXXXXXXXXXXX` | 將指定待辦改為 `completed` | 是 |
| `取消 TXXXXXXXXXXXX` | 將指定待辦改為 `cancelled` | 是 |
| `幫助` | 顯示可用格式 | 否 |

任務 ID 格式為大寫 `T` 加 12 位十六進位字元，例如：

```text
T708EA4DEF782
```

輸入小寫 ID 也可以，系統會正規化為大寫。

### 3.2 用自然語言新增任務

新增任務時必須同時提供清楚的日期與時間，例如：

```text
明天下午三點提醒我交企劃書
2026/10/28 上午 9 點準備週會資料
下週一晚上 8 點整理報稅文件
```

成功後會收到類似回覆：

```text
已新增任務：[T708EA4DEF782] 交企劃書
```

請保留任務 ID，完成或取消時需要使用它。

如果日期或時間不完整，例如：

```text
提醒我交企劃書
```

系統應詢問缺少的資訊，而且不會寫入 Data Table。

### 3.3 任務狀態

V0 使用三種狀態：

| 狀態 | 說明 |
|---|---|
| `pending` | 尚未完成，會出現在待辦查詢 |
| `completed` | 已完成，不再出現在待辦查詢 |
| `cancelled` | 已取消，不再出現在待辦查詢 |

完成或取消不會刪除資料列，而是保留最終狀態。已進入最終狀態的任務不能再次變更。

### 3.4 使用限制

- 日期查詢以 `Asia/Taipei` 時區計算。
- 標題最多 200 字，LINE 文字輸入最多 500 字。
- `未完成` 最多回傳 50 筆。
- 系統只接受一對一文字訊息。
- 只有預先設定的 owner LINE user ID 可以操作。
- Gemini 無效、逾時或輸出不合規時，系統會 fail closed，不寫入資料。

## 4. 系統架構

```text
LINE Messaging API
  → Tailscale Funnel（公開 HTTPS）
  → nginx :8080
      只接受 POST /webhook/line-events
  → LINE verifier sidecar
      raw body HMAC-SHA256 驗簽
      單一 owner allowlist
      只接受一對一文字訊息
      只轉送必要欄位
  → n8n internal webhook
      POST /webhook/line-events-internal
      X-LNTA-Internal-Token Header Auth
  → 固定指令或 Gemini structured JSON
  → 本機 validator
  → n8n Data Table: tasks
  → 固定 LINE Reply API
```

Gemini 不能決定或修改：

- LINE 使用者或 owner。
- reply token。
- API URL、HTTP method 或 headers。
- n8n credential。
- 未經 allowlist 的 intent。

## 5. 管理者日常操作

所有命令都在專案根目錄執行：

```bash
cd /path/to/n8n_line_bot
```

### 5.1 啟動

目前正式使用 `line` profile：

> 目前保留的本機 volume 尚待完成 internal Header Auth 升級。第一次恢復服務時不要直接執行下方日常命令；先依 [`../HANDOFF.md`](../HANDOFF.md) 用離線 CLI 取消發布舊 workflow，再只啟動 n8n editor 完成升級。

```bash
./scripts/docker-compose.sh --profile line up -d
./scripts/docker-compose.sh --profile line ps
```

正常時以下服務都應顯示 `healthy`：

- `lnta-n8n-1`
- `lnta-webhook-proxy-1`
- `lnta-webhook-verifier-1`

不要只執行不含 `--profile line` 的啟動指令，否則 verifier 不會啟動。

### 5.2 檢查 Funnel

```bash
tailscale status
tailscale funnel status
```

Funnel target 必須是：

```text
http://127.0.0.1:8080
```

不得直接指向 n8n `5678`。

如果 Funnel 沒有啟動：

```bash
tailscale funnel --bg 8080
```

### 5.3 執行測試

```bash
npm test
./scripts/verification/check-local-stack.sh
```

第一個命令應顯示 `53` 項全部通過。第二個命令檢查：

- n8n health endpoint。
- proxy 根路徑與管理路徑均為 404。
- Webhook 不接受 GET。
- 壓縮或過大 body 被拒絕。
- 未簽名請求在 verifier 被拒絕。

### 5.4 查看最小化日誌

```bash
./scripts/docker-compose.sh --profile line logs --tail=100 webhook-proxy webhook-verifier n8n
```

nginx 正常只會記錄時間、HTTP status、method 與 path。不要加入記錄 headers、body、query 或 credentials 的設定。

### 5.5 暫停公開服務

先關閉 LINE Developers Console 的 `Use webhook`，再關閉 Funnel：

```bash
tailscale funnel --https=443 off
```

### 5.6 停止容器

```bash
./scripts/docker-compose.sh --profile line down
```

不要加入 `--volumes`。刪除 volume 會一起刪除 workflow、credentials、Data Table 與 n8n encryption key。

## 6. 重新部署或更換電腦

### 6.1 必要軟體與帳號

- Node.js 20 以上。
- Docker Desktop / Docker Compose。
- Tailscale 帳號與支援 Funnel 的 macOS client。
- LINE Official Account 與 Messaging API channel。
- Gemini API key。

### 6.2 LINE verifier secrets

建立以下三個 ignored 檔案，各只放一行、不加引號：

```text
secrets/line_channel_secret
secrets/line_owner_user_id
secrets/n8n_internal_webhook_token
```

設定權限：

```bash
chmod 700 secrets
chmod 600 secrets/line_channel_secret secrets/line_owner_user_id secrets/n8n_internal_webhook_token
```

`line_owner_user_id` 必須是唯一允許使用者的 LINE user ID，格式為 `U` 加 32 位十六進位字元；它不是 bot Basic ID。

`n8n_internal_webhook_token` 必須是至少 32 字元的獨立隨機值。它只掛載到 verifier；相同值另存於 n8n 的 `LNTA Internal Webhook` Header Auth credential。

### 6.3 n8n Credentials

在 n8n editor 手動建立並綁定：

1. Gemini credential，供 `Google Gemini Intent` 節點使用。
2. Header Auth credential，名稱建議為 `LINE Channel Access Token`。
   - Header Name：`Authorization`
   - Header Value：`Bearer <Channel Access Token>`
3. Header Auth credential，名稱建議為 `LNTA Internal Webhook`。
   - Header Name：`X-LNTA-Internal-Token`
   - Header Value：與 `secrets/n8n_internal_webhook_token` 相同

`Bearer` 後面必須有一個半形空格。

不要把 Channel Access Token、Gemini API key 或 internal token 放進 `.env`、workflow JSON、Code node、截圖、聊天或 shell 參數。

### 6.4 `tasks` Data Table

| 欄位 | 類型 | 用途 |
|---|---|---|
| `task_id` | string | 對使用者顯示的穩定任務 ID |
| `source_event_id` | string | LINE webhook event ID，用於去重 |
| `line_user_id` | string | 任務 owner |
| `title` | string | 任務名稱 |
| `due_at` | datetime | 含時區的 ISO 8601 時間 |
| `status` | string | `pending` / `completed` / `cancelled` |

n8n 內建的 `id`、`createdAt`、`updatedAt` 不需重複建立。

### 6.5 匯入 workflow

匯入：

```text
workflows/V0-line-task-assistant.json
```

repository 內的匯出檔刻意保持 `active=false`，且不含 credential ID。匯入新環境後必須：

1. 選取正確的 Gemini credential。
2. 選取正確的 LINE Header Auth credential。
3. 將 `LNTA Internal Webhook` Header Auth credential 綁到 `LINE Webhook`。
4. 將所有 Data Table 節點指向正確的 `tasks` table。
5. 用 `Manual Test` 確認假資料只走 preview、不送 LINE。
6. 完成安全測試後才發布 workflow。

### 6.6 LINE 與 Funnel

`.env` 至少需要：

```dotenv
LNTA_PROXY_CONFIG=nginx.line.conf
N8N_WEBHOOK_URL=https://<funnel-host>/
```

LINE Developers Console 的 Webhook URL：

```text
https://<funnel-host>/webhook/line-events
```

設定順序：

1. 啟動 n8n、verifier 與 proxy。
2. 啟用只指向 `8080` 的 Funnel。
3. 在 LINE Console 更新 Webhook URL 並按 `Verify`。
4. `Verify` 成功後啟用 `Use webhook`。
5. 關閉 LINE Official Account Manager 的 Greeting messages、Auto-reply messages 與 Chat，避免重複回覆。
6. 先用 `幫助` 做不寫入資料的 smoke test。

## 7. 資料與備份

唯一的持久化邊界是 Docker volume：

```text
lnta_n8n_data
```

它包含：

- n8n workflow 與版本。
- 加密後的 n8n Credentials。
- n8n encryption key。
- `tasks` Data Table。

只備份 repository 或 workflow JSON，無法完整還原服務。正式長期使用前仍需完成：

1. volume 加密備份。
2. encryption key 的離線保存。
3. 在獨立 staging 環境做 restore drill。
4. 在 n8n、Docker 或 macOS 更新前建立可驗證備份。

目前 repository 內沒有已完成的備份與還原演練成品，因此不要執行：

```text
docker compose down --volumes
docker volume rm lnta_n8n_data
```

也不要在沒有備份時重設 Docker Desktop。

## 8. 安全設計

目前已有：

- LINE raw body HMAC-SHA256 驗簽。
- constant-time signature 比對。
- 單一 owner allowlist。
- 只接受一對一文字訊息。
- 公開面只允許精確 Webhook path 與 POST。
- body size、rate、connection 與 timeout 限制。
- n8n editor 只綁 localhost。
- verifier 不暴露 host port。
- verifier 到 n8n 的內部 Webhook 需要獨立 Header Auth token。
- Gemini intent allowlist 與完整本機 schema 驗證。
- Data Table 查詢與修改都帶 `line_user_id` scope。
- LINE Reply endpoint、method、headers 與 credential 固定。
- execution history 不保存 payload。
- repository workflow export 不含 credentials 或 production 身分資料。

仍待補強：

1. **備份與還原演練**：目前最大的營運風險。
2. **Code node 隔離**：workflow 有 11 個 Code nodes，目前仍使用 n8n internal runner；長期無人值守前應加入同版本 external task runner，或移除 Code nodes。
3. **本機 workflow 升級**：既有 `lnta_n8n_data` 內的 workflow 不會因 repository JSON 更新而自動改變；下次開機前必須在原 workflow 綁定 `LNTA Internal Webhook` credential 並重新發布。
4. **自動 integration tests**：真實 LINE、Gemini 與 Data Table 生命週期目前已有人工驗收，但尚未形成可一鍵重跑的完整套件。
5. **Data Table 一致性**：stable task ID、upsert 與 concurrency 1 可降低風險，但不等同資料庫 transaction 或 unique constraint。

## 9. 常見問題

### LINE 沒有回覆

依序確認：

1. Mac、Docker Desktop 與 Tailscale 正在運行。
2. 三個容器都是 healthy。
3. `tailscale funnel status` 顯示代理到 `127.0.0.1:8080`。
4. LINE Console 的 `Use webhook` 已開啟。
5. Workflow 顯示 `Published`。
6. `Send LINE Reply` 綁定正確的 Header Auth credential。
7. Channel Access Token 與 Channel Secret 來自同一個 channel。

### 收到兩則回覆

到 LINE Official Account Manager 關閉：

- Greeting messages。
- Auto-reply messages。
- Chat 或其他自動回覆。

### Webhook Verify 回傳 401

通常表示 Channel Secret 不符、簽章缺少，或設定到了不同的 Messaging API channel。不要修改或重新序列化 LINE 的 raw request body。

### Gemini 沒有建立任務

這通常是安全的 fail-closed 行為。確認訊息含有未來的明確日期與時間。以下情況都不會寫入：

- 缺日期或時間。
- 時間已過。
- Gemini 回傳無效 JSON。
- intent 不在 allowlist。
- `needs_confirmation=true`。

### proxy 不健康

確認使用 `line` profile：

```bash
./scripts/docker-compose.sh --profile line ps
./scripts/docker-compose.sh --profile line logs --tail=100 webhook-proxy webhook-verifier
```

### 任務或 Credentials 消失

檢查 `lnta_n8n_data` volume 是否仍存在。如果 volume 已刪除且沒有備份，無法只靠 workflow JSON 還原 Data Table、Credentials 與 encryption key。

## 10. Secret 疑似外洩時

1. 在 LINE Console 關閉 `Use webhook`。
2. 關閉 Funnel：

   ```bash
   tailscale funnel --https=443 off
   ```

3. 停止 stack。
4. 在 LINE 撤銷並重發 Channel Access Token，必要時重建 Channel Secret。
5. 在 Google 撤銷並重發 Gemini API key。
6. 更新本機 Docker secrets 與 n8n Credentials。
7. 重跑 `npm test`、local stack verification 與 LINE smoke test。

## 11. 專案目錄

```text
line-n8n-task-assistant/
├── compose.yaml                    # n8n、proxy、verifier
├── config/reverse-proxy/           # fail-closed 與 LINE proxy 設定
├── docs/                           # 規格、使用、驗收與截圖
├── scripts/docker-compose.sh       # 固定 Docker Compose 入口
├── scripts/verification/           # 本機安全檢查
├── secrets/                        # ignored；LINE secret、owner ID、internal token
├── src/                            # verifier、validation、query、mutation
├── tests/                          # validation 與 security tests
└── workflows/                      # credential-free n8n workflow export
```

主要文件：

- `README.md`：專案總覽。
- `HANDOFF.md`：clone、升級、日常更新與交接清單。
- `SECURITY.md`：secret、回報與外洩處理政策。
- `docs/PROJECT_STATUS_AND_USAGE.md`：本文件。
- `docs/START_STOP_GUIDE.md`：日常啟動、驗證、關閉與緊急關閉流程。
- `docs/V0_IMPLEMENTATION_SPEC.md`：V0 正式範圍。
- `docs/LOCAL_SETUP.md`：乾淨環境部署步驟。
- `docs/DEVELOPMENT.md`：開發與安全約定。
- `docs/IMPLEMENTATION_CHECKLIST.md`：驗收紀錄。
- `workflows/README.md`：workflow 結構與測試紀錄。
- `SYSTEM_SPEC.md`：未來 V1 參考，不代表目前 V0 已實作。

## 12. 建議下一步

1. 先完成 `lnta_n8n_data` 的加密備份與 restore drill。
2. 加入 external task runner 或逐步移除 Code nodes。
3. 下次啟動前完成既有 workflow 的 internal Header Auth 升級與 smoke test。
4. 將真實 Data Table、Gemini timeout、跨 owner 與 LINE stub 納入自動 integration tests。
5. 完成上述 hardening 後，再把 V0 標記為可長期無人值守的 production-ready 版本。
