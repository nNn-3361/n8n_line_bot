# 專案交接與後續更新指南

這份文件是回來接手專案時的第一入口。完整功能與限制見 [`docs/PROJECT_STATUS_AND_USAGE.md`](docs/PROJECT_STATUS_AND_USAGE.md)，日常開關機見 [`docs/START_STOP_GUIDE.md`](docs/START_STOP_GUIDE.md)，安全規則見 [`SECURITY.md`](SECURITY.md)。

## 目前交接狀態

- Git repository 只保存可公開的程式、設定範本、測試與文件。
- Docker 服務和 Tailscale Funnel 已關閉。
- 本機 Docker volume `lnta_n8n_data` 保留，內含既有 workflow、Data Table、加密 credentials 與 n8n encryption key。
- repository workflow 是未啟用的安全範本；workflow/version/webhook ID、credential ID 與 Data Table instance ID 均已移除。
- 53 項自動測試通過。
- 舊版已部署 workflow 尚未自動取得新加入的 internal Header Auth。下一次公開服務前，必須依下方升級步驟處理。

## Secret 放在哪裡

下列內容絕對不進 Git：

| 機密 | 保存位置 |
|---|---|
| LINE Channel Secret | `secrets/line_channel_secret` |
| 唯一允許的 LINE user ID | `secrets/line_owner_user_id` |
| verifier-to-n8n token | `secrets/n8n_internal_webhook_token`，以及 n8n 的 `LNTA Internal Webhook` credential |
| LINE Channel Access Token | n8n 的 `LINE Channel Access Token` credential |
| Gemini API key | n8n Gemini credential |
| Funnel hostname／本機部署值 | `.env` |
| n8n encryption key、Data Table、加密 credentials | Docker volume `lnta_n8n_data` |

`.env`、`secrets/`、資料庫、備份、credential exports 和常見 key/token 檔名均由 `.gitignore` 排除。不要用截圖、issue、commit message 或 terminal 參數傳遞這些值。

## 第一次／升級後啟動

1. 安裝 Node.js 20+、Docker Desktop 與 Tailscale，clone repository 後進入專案根目錄。
2. 從 `.env.example` 建立本機 `.env`，填入部署值；不要加入 API key 或 token。
3. 建立三個 secret files，各只含一行、無引號，並設為 `0600`：

   ```text
   secrets/line_channel_secret
   secrets/line_owner_user_id
   secrets/n8n_internal_webhook_token
   ```

   internal token 必須是獨立、至少 32 字元的隨機值。

4. **既有 volume 升級**：在任何 n8n server 啟動前，先用不開 port 的一次性 CLI 找到目標 workflow，並將它取消發布：

   ```bash
   ./scripts/docker-compose.sh run --rm --no-deps n8n list:workflow --active=true
   ./scripts/docker-compose.sh run --rm --no-deps n8n unpublish:workflow --id=<上一步顯示的目標 workflow ID>
   ```

   這兩個一次性容器不發布 host port。不要用 `--all`，以免影響 volume 內其他 workflow。全新 volume 沒有既有 workflow，可略過此步。

5. 只啟動 n8n editor；不要啟動 proxy、verifier 或 Funnel：

   ```bash
   ./scripts/docker-compose.sh up -d n8n
   ./scripts/docker-compose.sh ps
   ```

6. 打開 `http://localhost:5678`。使用既有 volume 時編輯原 workflow，將 `LINE Webhook` 的 Authentication 改為 Header Auth；全新環境則匯入 `workflows/V0-line-task-assistant.json`。
7. 建立或確認三項 credentials：Gemini、`LINE Channel Access Token`、`LNTA Internal Webhook`。後者使用 Header Name `X-LNTA-Internal-Token`，值必須等於本機 internal token secret。
8. 把 `LNTA Internal Webhook` 綁到 `LINE Webhook`；把 LINE credential 綁到 `Send LINE Reply`；把 Gemini credential 綁到 `Google Gemini Intent`。
9. 全新匯入時，將以下五個節點重新指向本機 `tasks` Data Table；既有 workflow 也逐一確認：

   - `Get Pending Tasks`
   - `Get Dated Tasks`
   - `Upsert Created Task`
   - `Find Task for Mutation`
   - `Update Task Status`

10. 執行 repository 測試：

   ```bash
   npm test
   ```

11. 先用 `Manual Test` 確認 preview 不送 LINE，再儲存並發布 workflow。
12. 這時才啟動 verifier 與 proxy，執行本機檢查；全部通過後才依 [`docs/START_STOP_GUIDE.md`](docs/START_STOP_GUIDE.md) 開 Funnel 並用 `幫助` 做 smoke test：

    ```bash
    ./scripts/docker-compose.sh --profile line up -d webhook-verifier webhook-proxy
    ./scripts/verification/check-local-stack.sh
    ```

## 日常更新流程

開始前：

```bash
git status --short
git pull --ff-only
```

修改後：

```bash
npm test
npm run verify:publication
git status --short
git diff --check
git diff
```

提交前逐項確認：

- `.env`、`secrets/`、n8n volume／SQLite、backup、execution export 沒有出現在 `git status`。
- workflow JSON 沒有 credentials、production user ID、workflow/version/webhook ID、Data Table instance ID、raw body 或 reply token。
- 沒有真實 Funnel hostname、個人電腦絕對路徑或帳號識別資料。
- 所有測試通過，而且只 stage 這次要公開的檔案。

再提交與推送：

```bash
git add <reviewed-files>
git diff --cached --check
git diff --cached --name-only
git commit -m "Describe the change"
git push
```

如果從 n8n UI 更新 workflow，匯出後必須再次去識別，不可直接提交原始 export。至少移除 credentials、workflow/version/webhook ID 與 Data Table ID，保持 `active=false`，再執行 `npm test`。

## 關閉與緊急處理

正常關閉必須先關 Funnel，再停止 Compose；不要加 `--volumes`：

```bash
tailscale funnel off
./scripts/docker-compose.sh --profile line down
```

若懷疑任何 secret 外洩，維持服務關閉，輪替受影響的 LINE/Gemini/internal token，更新 n8n credentials，重新測試後才恢復。完整步驟見 [`SECURITY.md`](SECURITY.md)。

## 尚待處理

1. 在既有本機 workflow 完成 internal Header Auth 升級與重新發布。
2. 建立 `lnta_n8n_data` 的加密備份並做 restore drill。
3. 將 n8n internal Code runner 改為同版本 external task runner，或逐步移除 Code nodes。
4. 將真實 Data Table、Gemini timeout、跨 owner 與 LINE stub 測試自動化。
