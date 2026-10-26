# LINE × n8n × Gemini 個人任務助理

一個可以直接在 LINE 裡使用的個人待辦助手。

使用者不需要安裝新 App，也不需要學習複雜介面；只要傳送一句話，就能新增、查詢、完成或取消任務。

## 使用方式

### 用自然語言新增任務

```text
使用者：明天下午三點提醒我交企劃書
助理：已新增任務：[T708EA4DEF782] 交企劃書
```

如果缺少日期或時間，系統會先詢問，不會直接寫入：

```text
使用者：提醒我交企劃書
助理：請問要在哪一天、幾點提醒？
```

### 用固定指令管理任務

| 指令 | 功能 |
|---|---|
| `今天` | 查看今天的待辦 |
| `明天` | 查看明天的待辦 |
| `未完成` | 查看所有待辦 |
| `完成 T...` | 完成指定任務 |
| `取消 T...` | 取消指定任務 |
| `幫助` | 顯示使用方式 |

固定指令不會呼叫 AI，回覆快速且結果可預期。

## 系統架構

```text
LINE 使用者
    │
    ▼
LINE Messaging API
    │  HTTPS Webhook
    ▼
Tailscale Funnel
    │
    ▼
受限反向代理
    │  只開放指定 POST 路徑
    ▼
LINE Webhook Verifier
    │  驗證簽章與唯一使用者，加入內部 Header Auth
    ▼
n8n Workflow
    ├─ 固定指令解析
    ├─ Gemini 結構化意圖
    ├─ 本機安全驗證
    └─ Data Table 任務資料
    │
    ▼
LINE Reply API
```

## 值得介紹的系統設計

### 1. AI 負責理解，不負責授權

Gemini 只把自然語言轉成受限制的 JSON intent，例如：

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

AI 不能決定使用者身分、LINE 收件人、API URL、HTTP method、headers 或 credential。模型輸出必須通過本機 schema、日期、task ID 與 intent allowlist 驗證後，系統才會執行。

### 2. Webhook 採分層驗證

公開入口不直接連到 n8n，而是依序經過：

1. 精確路徑與 HTTP method 限制。
2. LINE raw body HMAC-SHA256 簽章驗證。
3. 單一 owner allowlist。
4. 欄位清理與長度限制。
5. verifier-to-n8n Header Auth 與 n8n 內部安全閘門再次驗證。

不合法請求會在接觸 Gemini 或任務資料前被拒絕。

### 3. 每一次資料操作都帶 owner scope

任務查詢、完成與取消都在資料存取層限制 `line_user_id`。回覆前還會再次核對 owner、任務 ID 與狀態，避免只靠流程前段的一次身分判斷。

### 4. 寫入具備實用的去重設計

任務 ID 由通過驗簽的 LINE webhook event ID 衍生；新增採用 upsert，workflow 並行度限制為 1。這能降低 Webhook 重送造成重複任務的風險。

### 5. 任務狀態只能安全前進

任務只有三種狀態：

```text
pending → completed
pending → cancelled
```

完成或取消後不能再次變更，避免重複操作與衝突更新。

### 6. 最小化公開面與資料留存

- 公網只開放 LINE Webhook 路徑。
- n8n editor 只允許本機存取。
- Secrets 與 API keys 不放進 workflow 或 Git。
- Execution history 不保存訊息 payload。
- Logs 不記錄訊息本文、Authorization 或 reply token。
- LINE 回覆固定使用 Reply API，不使用主動 Push。

## 已完成驗證

- 53 項自動化測試全部通過。
- 真實 LINE Webhook Verify 成功。
- `幫助`、`今天`與`明天`查詢成功。
- 自然語言新增任務成功。
- 新增任務可由 Data Table 查回。
- 使用任務 ID 取消成功。
- 取消後不再出現在待辦清單。
- 公開入口的非預期路徑均回傳 404。
- 真實測試後的服務 logs 未包含訊息內容或敏感 Token。

## 技術組合

| 元件 | 角色 |
|---|---|
| LINE Messaging API | 使用者介面與訊息傳遞 |
| n8n | Workflow orchestration |
| Gemini | 自然語言轉結構化 intent |
| n8n Data Table | V0 任務儲存 |
| Node.js | Webhook 驗簽與本機驗證邏輯 |
| nginx | Exact-path reverse proxy |
| Tailscale Funnel | 公開 HTTPS Webhook 入口 |
| Docker Compose | 本機服務與持久化管理 |

## V0 範圍

這一版專注在「安全完成單人任務管理的核心流程」。目前不包含主動提醒、多使用者、群組、附件、對話記憶或任務修改。

未來可擴充方向：

- 定時提醒與每日摘要。
- 任務修改與更完整的日期語意。
- PostgreSQL 與更強的一致性保證。
- 自動化備份與還原演練。
- 更完整的 integration test pipeline。

## 專案文件

- [完整使用與維運手冊](./PROJECT_STATUS_AND_USAGE.md)
- [V0 實作規格](./V0_IMPLEMENTATION_SPEC.md)
- [安全與開發約定](./DEVELOPMENT.md)
- [實作驗收清單](./IMPLEMENTATION_CHECKLIST.md)
