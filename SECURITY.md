# Security Policy

## 不可提交的資料

不得提交或貼到 issue／聊天／截圖：

- `.env` 與 `secrets/` 內容。
- LINE Channel Secret、Channel Access Token、user ID、reply token。
- Gemini API key。
- verifier-to-n8n internal token。
- n8n encryption key、credential export、SQLite／Data Table 資料或 execution payload。
- 私有 Funnel hostname、production webhook payload 或 Authorization header。

公開的 workflow 必須保持 `active=false`，且不含 credential ID、workflow/version/webhook ID、目標環境 Data Table ID、pinned production data 或執行紀錄。

## 安全架構

- 公網只允許精確的 `POST /webhook/line-events`。
- LINE raw body 在解析前以 HMAC-SHA256 驗簽。
- verifier 只允許一個預先設定的 owner，且只轉送清理過的欄位。
- verifier 到 n8n 的內部 Webhook 另要求 `X-LNTA-Internal-Token` Header Auth。
- n8n editor 只綁 loopback；Funnel 絕不可指向 `5678`。
- Gemini 僅輸出受限制 intent；資料與 LINE Reply 的權限欄位均由本機程式重驗。
- execution payload 不保存，logs 不記錄 body、headers 或 secrets。

## 提交前檢查

```bash
npm test
npm run verify:publication
git status --short
git diff --check
git diff --cached --check
git diff --cached --name-only
```

確認 staged 清單沒有 `.env`、`secrets/`、database、backup、execution export 或 credential file。不要只依賴 `.gitignore`；每次都人工檢視 staged diff。

## 回報漏洞

此專案是個人部署用途。不要在公開 GitHub issue 貼出可利用細節或任何真實憑證。請先停用 LINE `Use webhook`、關閉 Funnel 和 Compose，再透過 repository owner 可驗證的私人聯絡管道回報。

## 疑似外洩

1. 關閉 LINE `Use webhook`。
2. 執行 `tailscale funnel off`。
3. 執行 `./scripts/docker-compose.sh --profile line down`，不要加 `--volumes`。
4. 依影響範圍輪替 LINE Channel Access Token／Channel Secret、Gemini API key 與 internal token。
5. 更新 Docker secret files 與 n8n credentials。
6. 檢查 Git 歷史；若秘密曾進入 commit，單純刪除最新檔案不夠，應撤銷秘密並另行清理歷史。
7. 重跑測試、本機檢查與最小化 smoke test 後才恢復服務。

不要把舊 token 再利用，也不要為了保留相同值而延後輪替。
