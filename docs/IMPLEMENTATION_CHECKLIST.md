# V0 實作檢查表

## Step 1：收斂專案方向

- [x] 將當前目標改為 LINE + n8n + Gemini + Data Table。
- [x] 把 PostgreSQL、SQL migration、Push、提醒、報表與複雜 recovery 移出 V0。
- [x] 保留 `SYSTEM_SPEC.md` 作為未來 V1 參考。
- [x] 建立 V0 專用規格、開發約定與安全邊界。
- [x] 將 production concurrency 預設調整為 1。

## Step 2：可執行的 n8n 本機環境

- [x] 安裝或啟用 Docker Engine/Compose 或其他可持久化執行 n8n 的環境。
- [x] 查證並固定 n8n 與 reverse proxy image 版本，不使用 `latest`。
- [x] 建立只含 n8n 與 reverse proxy 的 `compose.yaml`。
- [x] 建立 n8n persistent volume、healthcheck、resource limit、restart policy 與 log rotation。
- [x] 讓 n8n 在 persistent volume 產生與保存 encryption key，不寫入 repository 或 `.env`。
- [x] 確認 editor 只綁定 localhost。
- [x] 確認本機階段尚未啟用 Funnel。

## Step 3：`tasks` Data Table

- [x] 建立 `tasks` Data Table，加入 `task_id`、`source_event_id`、`line_user_id`、`title`、`due_at`、`status` 六個業務欄位。
- [x] 確認使用 n8n 內建的 `id`、`createdAt`、`updatedAt`，不建立重複時間欄位。
- [x] 建立穩定 task ID 產生規則。
- [x] `今天`、`明天`、`未完成` 查詢在 Data Table 層使用 `line_user_id + status` 篩選，日期查詢另使用半開區間。
- [x] 新增使用 `source_event_id + line_user_id` upsert，完成／取消使用 `task_id + line_user_id + pending` 篩選。
- [x] 驗證 workflow 重跑不會重複新增任務。
- [x] 驗證 n8n 重啟後 `tasks` Data Table 仍存在。

## Step 4：指令與 Gemini structured output

- [x] 實作「今天、明天、未完成、完成 ID、取消 ID、幫助」的固定指令。
- [x] 定義 Gemini JSON Schema 與可接受 intent allowlist。
- [x] 實作本機 validation，不只依賴 structured-output 格式。
- [x] 確認 `needs_confirmation=true` 及任何無效輸出都不會寫入。
- [x] 確認固定指令不呼叫 Gemini。
- [x] 確認 Gemini 無法控制 user ID、LINE URL、method、headers 或 credential。
- [x] 建立本機 Gemini credential，使用 JSON output、關閉所有 built-in tools，並將模型輸出送入本機 validator。

## Step 5：單一 V0 workflow

- [x] 公開入口由 verifier 保留 raw body；n8n 只接收 sanitized event 並回覆 HTTP 200。
- [x] verifier 在解析 JSON 前驗證 LINE HMAC-SHA256，並使用 constant-time 比對。
- [x] verifier 只允許 Docker secret 中預先設定的單一 `line_user_id`。
- [x] verifier 到 n8n 的內部 Webhook 使用獨立 Docker secret 與 n8n Header Auth credential；公開匯出檔不含 token 或 credential ID。
- [x] 限制文字長度並只處理一對一文字訊息。
- [x] Switch 先處理固定指令，必要時才進入 Gemini 分支。
- [x] Gemini 模糊輸入整合測試回傳 `needs_confirmation=true` 與 `can_write=false`，不觸及 Data Table mutation。
- [x] 驗證 `list_tasks` intent 後執行 owner-scoped Data Table Get，最多回傳 50 筆並依 `due_at` 排序。
- [x] 驗證 mutation intent 後執行 owner-scoped Data Table Upsert/Update，並在輸出層再次核對 owner、task ID 與狀態。
- [x] LINE Reply endpoint、method、message type 與 body 結構全部固定；reply token 只接受 verifier event，且不接受 Gemini 提供 URL、recipient、headers 或 credential。
- [x] 在 n8n 建立 `LINE Channel Access Token` Header Auth credential 並綁定 `Send LINE Reply`。
- [x] 將本機 V0 workflow 以 `V0 LINE Reply smoke test` 版本正式發佈；credential-free 匯出檔仍保持未啟用。
- [x] 清除 workflow export 中的 credential ID、pinned data 與敏感 payload。
- [x] 清除 workflow/version/webhook ID 與目標環境 Data Table ID，匯入後明確要求重新綁定。
- [x] 建立本機 Docker secret files，切換 `nginx.line.conf` 並啟用 `line` Compose profile。

## Step 6：安全測試與公開入口

- [x] verifier 測試確認錯誤或缺少簽章不會轉送到 n8n，因此不會呼叫 Gemini 或 Data Table。
- [x] verifier 測試確認未授權使用者不會轉送到 n8n；查詢節點與格式化層皆再次比對 owner。
- [ ] 跨使用者 task ID 查詢／更新失敗。
- [x] 重送同一 create event 不會新增第二筆任務。
- [ ] Gemini timeout、無效 JSON 與惡意輸出都 fail closed。
- [x] proxy 設定測試確認公開面只允許 `POST /webhook/line-events`。
- [x] proxy/verifier 設定及測試涵蓋 body limit、rate/connection limit、timeout 與 log rotation。
- [x] Tailscale Funnel 只代理至 loopback `8080`；公開根路徑與內部健康路徑均回傳 404，n8n editor `5678` 不公開。
- [x] 使用真實本機 Channel Secret 與 owner user ID，完成 proxy → verifier → n8n Test Webhook → 固定指令的完整鏈路測試。
- [x] 使用真實 LINE webhook 完成一次「幫助」Reply smoke test，確認單一 reply token 只產生一則預期回覆。
- [x] 使用真實 LINE 完成「今天」唯讀查詢，以及自然語言新增 →「明天」查回 → owner-scoped 取消 → 待辦查詢排除的完整生命週期驗收。
- [x] execution history 設為不保存成功、失敗、進度與手動執行資料；真實 smoke test 後檢查服務 logs，未包含 raw body、訊息本文、reply token、Authorization 或 secret。
- [x] 53 項 repository 自動測試全數通過，包含 internal token、secret 掛載邊界與公開匯出檔去識別檢查。
- [ ] 既有本機 n8n workflow 在下次啟動前綁定新的 `LNTA Internal Webhook` credential，重新發布並完成 smoke test。

## V0.5 以後才評估

- [ ] 每日最多一則的任務摘要與月份計數。
- [ ] 任務修改、全天任務與更廣的中文日期。
- [ ] 需要更強一致性時，再將 Data Table 遷移至 PostgreSQL。
- [ ] 每筆提醒、Push quota、reservation、recovery 與加密備份。
