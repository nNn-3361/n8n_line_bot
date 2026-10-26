# Intent validation source

這裡放置無 n8n 依賴的純 JavaScript 驗證邏輯，用來產生穩定 task ID、解析固定指令，以及檢查 Gemini structured output。測試通過後，再將等價邏輯放入 V0 workflow；SHA-256 task ID 可由 n8n Crypto node 產生，其他驗證放入 Code node。

驗證層只產生受限制的 intent 與資料欄位，不處理 credential、LINE recipient、URL、HTTP method 或 headers。

主要介面：

- `createTaskId(webhookEventId)`：產生 `T` 加 12 位大寫 SHA-256 摘要。
- `parseFixedCommand(text)`：命中固定指令時回傳 `call_gemini: false`，否則回傳 `null`。
- `validateGeminiIntent(payload, { now })`：解析、驗證並清洗 Gemini JSON；只有安全且完整的寫入意圖會得到 `can_write: true`。
- `gemini-intent.schema.json`：提供給 Gemini structured output 的 allowlist 契約。
