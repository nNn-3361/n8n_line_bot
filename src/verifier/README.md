# LINE webhook verifier

這個小型 sidecar 是公開 Webhook 與 n8n 之間的安全邊界：

1. 讀取原始 request bytes。
2. 使用 Docker secret 中的 LINE Channel Secret 計算 HMAC-SHA256。
3. 使用 `timingSafeEqual` 比對 `X-Line-Signature`。
4. 簽章正確後才解析 JSON。
5. 只接受 Docker secret 中指定的單一 `line_user_id` 與一對一文字訊息。
6. 只把 allowlist 內的欄位轉送到 n8n 內部 Webhook，並附上只由 verifier 與 n8n credential 持有的 `X-LNTA-Internal-Token`。

它不記錄 request body、signature、reply token、user ID 或 secret。服務位於 Compose `line` profile；缺少任一 Docker secret（LINE Channel Secret、owner ID、internal token）時不會啟動，也不影響目前本機 n8n editor。
