# n8n workflows

V0 只維護一個主要匯出檔：

| 檔名 | 用途 |
|---|---|
| `V0-line-task-assistant.json` | V0 主 workflow。目前是未發佈的安全骨架：verifier-only 內部 Webhook、fail-closed 安全閘門、owner-scoped Data Table 查詢／mutation、手動假資料、固定指令分流，以及 Gemini structured JSON＋本機 validator。 |

## 目前骨架

- 公開 `POST /webhook/line-events` 由 verifier 先以 raw body 驗簽及套用 owner allowlist；n8n 不直接暴露在此路徑。
- `LINE Webhook` 固定使用內部 `POST /webhook/line-events-internal`，要求 `X-LNTA-Internal-Token` Header Auth，只接受 verifier 的 sanitized envelope，並立即回覆 HTTP 200。
- `Normalize LINE Request` 與 `Security Gate (Fail Closed)` 會檢查 verifier 版本標記、安全旗標與欄位格式；任何不符都停止。
- `Manual Test` 使用明確的 `LOCAL_*` 假資料，可在 editor 內測試固定指令，不會對外傳送或寫入 Data Table。
- `Intent Route` 先走固定指令；`今天`、`明天`、`未完成` 會進入 owner-scoped Data Table 查詢，只有其他自然語言會呼叫 Gemini。
- `Google Gemini Intent` 使用 JSON output、temperature 0、單一 candidate，且不啟用 Search、Maps、URL Context、File Search、Code Execution 或任何 tool。
- `Validate Gemini Intent` 不信任模型輸出，會重新解析完整七欄位契約、intent allowlist、task ID、未來 ISO 時間與 confirmation 規則；錯誤、timeout 或不相容回應一律 `can_write=false`。
- 日期查詢使用台北時區 `[day start, next day start)` 半開區間；所有查詢限制 `line_user_id + pending`、最多 50 筆並依 `due_at` 升冪排序。
- Data Table filter 之外，`Format Task Query Result` 仍會重新核對 owner、status、task ID 與日期區間，再產生受信任的 `reply_text`。
- 新增任務的 task ID 由 verifier 根據 LINE webhook event ID 產生，並以 `source_event_id + line_user_id` upsert；Gemini 不能指定 task ID 或 owner。
- 完成／取消先以 `task_id + line_user_id` 查找，只有唯一一筆 `pending` 任務可進入更新；Update 節點再以 `task_id + line_user_id + pending` 限制，避免跨 owner 與競態更新。
- mutation 輸出會再次核對 owner、task ID 與預期狀態；不符就 fail closed，不產生成功回覆。
- `Prepare LINE Reply` 只接受 verifier 完整安全標記與非空 reply token 才能進入送出分支；手動事件固定走 preview，並將假 reply token 清成 `null`。
- `Send LINE Reply` 固定使用 `POST https://api.line.me/v2/bot/message/reply`、單一 text message、10 秒 timeout、禁止 redirect，以及 n8n Header Auth credential；Gemini 無法控制 endpoint、method、headers、recipient 或 credential。
- credential-free 匯出檔預設未啟用，且沒有 credential ID、secret、production user ID、workflow/version/webhook ID 或目標環境的 Data Table ID。

舊版的本機 workflow 曾完成 credential 綁定與真實 Reply smoke test；目前服務已關閉。重新匯入或升級此安全範本時，必須重新指定 `tasks` Data Table，並綁定 Gemini、LINE Reply 與 `LNTA Internal Webhook` 三項 credentials，完成安全檢查後才能發佈。

## 已驗證行為

- `Manual Test` 的「今天」會輸出 `intent=list_tasks`、`query_range=today`、`call_gemini=false`。
- verifier 測試已覆蓋正確／錯誤／缺少簽章、未授權 owner、非文字與過長訊息、無效 JSON、body/path/method/content-type 限制及 downstream failure。
- 使用本機 Docker secrets 的完整鏈路測試已成功將簽章正確、owner 正確的「今天」事件送到 n8n，並以固定指令路徑抵達 `Validated Intent Preview`；本機 workflow 已以 `V0 LINE Reply smoke test` 版本發佈，credential-free 匯出檔則維持未啟用。
- owner 正確的「未完成」簽章事件已成功經過 verifier 與 Data Table 查詢到達最終預覽。
- 真實 LINE webhook 的「幫助」固定指令已成功收到單一預期 Reply；此路徑不呼叫 Gemini，也不寫入 Data Table。
- 真實 LINE 已完成「今天」唯讀查詢，以及自然語言新增測試任務、以「明天」查回、使用任務 ID 取消、再次查詢確認已從 pending 清單排除的完整生命週期驗收。
- workflow 已加入 Data Table upsert/update、Gemini structured JSON 與 LINE Reply 安全分支；53 項自動測試覆蓋事件 task ID、內部 Header Auth 與 secret 掛載邊界、owner 隔離、重複／最終狀態拒絕、無效 Gemini/mutation fail closed、Reply authority boundary 與 export 安全性。
- Gemini 對缺少日期時間的「提醒我交企劃書」產生確認問題；validator 驗證後輸出 `needs_confirmation=true`、`can_write=false`，執行成功且沒有寫入 Data Table。
- Data Table 實際 mutation 整合測試已通過：自然語言建立任務成功；相同 event 重送後總筆數仍為 1；完成成功；重複完成不寫入；完成後取消回傳 `invalid_status_transition`，狀態維持 `completed`。測試畫面見 `docs/v0-data-table-mutation-integration.png`；假資料已在測試後刪除，清理結果見 `docs/v0-data-table-cleanup-complete.png`。
- LINE Reply 手動路徑已驗證輸出 `delivery_mode=preview`、`send_line_reply=false`、`reply_token=null`，因此本機假資料不會呼叫 LINE。畫面見 `docs/v0-line-reply-preview.png`。
- 更新後的 29 節點 workflow 已在 n8n editor 以「今天」手動路徑執行成功；畫面紀錄見 `docs/v0-safe-mutations-success.png`。
- workflow 已匯入本機 Personal project，並以 `V0 LINE Reply smoke test` 版本發佈；repository 內的匯出檔仍維持未啟用且不含 credential ID。

## 匯出前檢查

- 移除 credential ID、pinned production data 與 execution payload。
- 不得包含 LINE/Gemini secret、production user ID、raw webhook body 或 reply token。
- LINE endpoint 只能出現 `https://api.line.me/v2/bot/message/reply`。
- 不得出現 Push/broadcast/multicast/narrowcast endpoint。
- 不得出現 Schedule Trigger 或 AI Agent 可直接呼叫的 Data Table/HTTP tools。

V0.5 若加入每日摘要，必須以獨立規格與測試建立第二個 workflow，不在 V0 預留未啟用的 Push 邏輯。
