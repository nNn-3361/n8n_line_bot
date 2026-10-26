# LINE × n8n × Gemini 個人任務助理

本專案先實作一個「快速、安全、可擴充」的 V0：LINE 接收訊息，n8n 控制流程，Gemini 只負責把自然語言轉成受限制的結構化意圖，任務存在 n8n Data Table。

目前狀態：V0 程式、驗證核心、exact-path reverse proxy、LINE HMAC/owner verifier sidecar、Data Table 與 LINE Reply 流程均已完成並曾在本機通過端對端驗收。公開的 workflow 是刻意去識別、未啟用、未綁 credential／Data Table 的安全範本；verifier 到 n8n 的內部 hop 另以 Header Auth token 保護。53 項自動測試全部通過。為了安全交接，目前 Docker 服務與 Tailscale Funnel 均已關閉，本機 `lnta_n8n_data` volume 保留。重新啟用前請先依 [`HANDOFF.md`](./HANDOFF.md) 完成內部 credential 與 Data Table 綁定檢查。

## 當前實作依據

- 對外展示版專案介紹：[`docs/SHOWCASE.md`](./docs/SHOWCASE.md)
- 目前成品狀態、使用方式與注意事項：[`docs/PROJECT_STATUS_AND_USAGE.md`](./docs/PROJECT_STATUS_AND_USAGE.md)
- 日常啟動與關閉流程：[`docs/START_STOP_GUIDE.md`](./docs/START_STOP_GUIDE.md)
- 後續接手與更新流程：[`HANDOFF.md`](./HANDOFF.md)
- 安全政策與 secret 處理：[`SECURITY.md`](./SECURITY.md)
- V0 實作規格：[`docs/V0_IMPLEMENTATION_SPEC.md`](./docs/V0_IMPLEMENTATION_SPEC.md)
- 本機啟動說明：[`docs/LOCAL_SETUP.md`](./docs/LOCAL_SETUP.md)
- 開發約定：[`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md)
- 實作檢查表：[`docs/IMPLEMENTATION_CHECKLIST.md`](./docs/IMPLEMENTATION_CHECKLIST.md)
- 未來完整版參考：[`SYSTEM_SPEC.md`](./SYSTEM_SPEC.md)

`SYSTEM_SPEC.md` 保留 PostgreSQL、主動提醒、Push quota 與完整 recovery 設計，但不是 V0 的目前實作範圍。若兩份文件在 V0 範圍衝突，以 `V0_IMPLEMENTATION_SPEC.md` 為準。

## V0 功能

- 新增任務。
- 查詢今天、明天與未完成任務。
- 完成或取消指定任務。
- 顯示幫助。
- 全部以 LINE Reply 回覆，不使用 Push。

V0 不做定時提醒、日報、週報、對話記憶、模糊參照、任務修改、PostgreSQL 或複雜的額度／recovery 系統。

## 目錄結構

```text
.
├── config/reverse-proxy/  # 唯一公開 Webhook 的代理設定
├── docs/                  # V0 規格、實作順序與開發約定
├── scripts/verification/ # 部署與安全檢查
├── src/queries/           # Data Table 查詢邊界與回覆格式
├── src/mutations/         # Data Table 寫入／狀態轉換的安全邊界
├── src/validation/        # Gemini 輸出的純 JavaScript 驗證邏輯
├── tests/
│   ├── integration/       # n8n/Data Table/LINE stub 整合測試
│   ├── security/          # 驗簽、allowlist 與公開面測試
│   └── validation/        # Gemini JSON 與固定指令測試
└── workflows/             # V0 n8n workflow 匯出檔
```

## 目前實作順序

1. 確認或建立可執行 n8n 的本機環境。
2. 在 n8n 建立一張 `tasks` Data Table。
3. 先建立「固定指令＋Gemini structured output 驗證」。
4. 建立 LINE verifier 與單一 V0 workflow：raw body 驗簽 → owner allowlist → 帶 Header Auth 的內部 Webhook → intent → Data Table → LINE Reply。
5. 用本機/staging 假資料通過重送、跨使用者與惡意 Gemini 輸出測試。
6. 最後才開啟 exact-path reverse proxy 與 Tailscale Funnel。

## 本機測試

驗證核心不需要 LINE 或 Gemini credential：

```bash
npm test
```

## 不能拿掉的安全邊界

- 以未改寫的 raw body 驗證 LINE HMAC-SHA256 簽章。
- 只允許事先設定的單一 `line_user_id`。
- production workflow concurrency 設為 1，所有寫入使用穩定 ID 與 upsert。
- Gemini 只能建議 allowlist 內的 intent，n8n 必須再驗證才可寫入。
- Gemini 不能決定 LINE 收件人、API URL、HTTP method、header 或 credential。
- LINE Channel Secret 與 owner user ID 只存在 verifier 的 Docker secret files；Channel Access Token 與 Gemini API key 只存在 n8n Credentials。
- verifier-to-n8n token 只存在 ignored Docker secret 與 n8n 加密的 Header Auth credential；不寫入 workflow export。
- 正式入口只允許 `POST /webhook/line-events`；n8n editor 不對外公開。
- 不在 execution history 或匯出檔儲存 raw body、reply token、Authorization 或 secret。
