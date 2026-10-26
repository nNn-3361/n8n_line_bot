# 本機 n8n 環境

## 固定版本

| 元件 | 版本 | 用途 |
|---|---|---|
| n8n | 2.44.6 | V0 workflow、Credentials 與 Data Table |
| nginx | 1.30.6 Alpine | exact-path webhook proxy |
| Docker Desktop | 29.6.1 | 本機 container runtime |

`compose.yaml` 同時固定了 image digest，不使用 `latest`。

## 啟動

```bash
./scripts/docker-compose.sh up -d
./scripts/docker-compose.sh ps
```

n8n editor 只能從本機開啟：

```text
http://localhost:5678
```

Webhook proxy 的本機測試位址：

```text
http://localhost:8080/webhook/line-events
```

全新環境在 workflow、驗簽與 allowlist 測試通過前，不應將 `8080` 發布到外網；通過後，Tailscale Funnel 也只能指向這個本機 port，不能直接指向 n8n `5678`。目前交接狀態請見 `PROJECT_STATUS_AND_USAGE.md`。

## 啟用 LINE verifier（需要你親自放入 secrets）

預設的 `nginx.conf` 會 fail closed，因此只啟動基礎 profile 時不需要任何真實 LINE secret。準備啟用 `line` profile 測試真實 LINE Channel 時，在專案根目錄執行：

```bash
mkdir -p secrets
chmod 700 secrets
nano secrets/line_channel_secret
nano secrets/line_owner_user_id
nano secrets/n8n_internal_webhook_token
chmod 600 secrets/line_channel_secret secrets/line_owner_user_id secrets/n8n_internal_webhook_token
```

三個檔案都只放一行、不加引號：

- `line_channel_secret`：LINE Developers 中該 Messaging API channel 的 Channel secret。
- `line_owner_user_id`：唯一允許使用這個 bot 的 LINE user ID，格式為 `U` 加 32 位十六進位字元；不是 bot 的 Basic ID。
- `n8n_internal_webhook_token`：至少 32 字元的獨立隨機值，只用於 verifier 到 n8n 的內部請求。可在安全的本機終端用 `openssl rand -hex 32` 產生後貼入檔案。

不要把值貼到聊天室或命令列參數中。`secrets/` 已由 `.gitignore` 排除。

接著建立或編輯 `.env`，保留既有內容並加入：

```dotenv
LNTA_PROXY_CONFIG=nginx.line.conf
```

啟用 verifier profile 並重建 proxy：

```bash
./scripts/docker-compose.sh --profile line up -d --force-recreate webhook-verifier webhook-proxy
./scripts/docker-compose.sh --profile line ps
```

此時資料流為：公開 `POST /webhook/line-events` → verifier → n8n 內部 `POST /webhook/line-events-internal`。verifier 不暴露 host port；Channel Secret 與 owner user ID 也不會掛載到 n8n container。

## 建立內部 Webhook credential

公開匯出檔中的 `LINE Webhook` 已設為 Header Auth，但刻意不包含 credential ID。啟動公開入口前必須在 n8n 建立 credential 並綁定：

1. 在 n8n **Credentials** 建立 **Header Auth**，名稱建議為 `LNTA Internal Webhook`。
2. Header Name 填 `X-LNTA-Internal-Token`。
3. Header Value 填入與 `secrets/n8n_internal_webhook_token` 完全相同的值。
4. 回到 workflow，將此 credential 綁到 `LINE Webhook` 節點。
5. 儲存、測試後才發布 workflow。

不要把 internal token 寫入 `.env`、workflow JSON、Code node、終端參數或截圖。若是從舊的本機 workflow 升級，必須編輯原 workflow 的 `LINE Webhook` 節點並重新發布；只更新 repository JSON 不會自動修改 `lnta_n8n_data` 內的既有 workflow。

若要暫時回到 fail-closed proxy，把 `.env` 的 `LNTA_PROXY_CONFIG` 改回 `nginx.conf`，再重建 `webhook-proxy`。不要刪除 n8n volume。

## 建立 LINE Reply credential

`Send LINE Reply` 節點使用 n8n 的 Header Auth credential，不把 Channel Access Token 寫入 workflow、`.env`、Docker secret 或 Git。

1. 在 LINE Developers Console 開啟同一個 Messaging API channel，取得 Channel Access Token。
2. 在 n8n 的 **Credentials** 選擇 **Create credential**，類型選 **Header Auth**。
3. credential 名稱填 `LINE Channel Access Token`。
4. Header Name 填 `Authorization`。
5. Header Value 填 `Bearer ` 加上一個空格，再接 Channel Access Token。
6. 儲存後，回到 `V0 LINE Task Assistant [SAFE SKELETON]`，將此 credential 綁定到 `Send LINE Reply`。

不要把 Channel Access Token 貼到聊天、終端命令、workflow JSON 或截圖。LINE Reply endpoint 固定為 `POST https://api.line.me/v2/bot/message/reply`；reply token 只能使用一次，並應在收到 webhook 後一分鐘內使用。

## 停止

```bash
./scripts/docker-compose.sh down
```

`down` 不會刪除 `lnta_n8n_data` volume。不要加上 `--volumes`，否則 workflow、credential、Data Table 與 n8n 自動產生的 encryption key 都會被刪除。

## 本機與上線設定差異

本機 editor 使用 HTTP，所以 `N8N_SECURE_COOKIE=false`。上線後若 editor 改用私人 HTTPS，必須改為 `true`。

在實際 Funnel hostname 確定前，`N8N_WEBHOOK_URL` 維持本機預設。正式啟用 LINE Webhook 前必須將它設為：

```text
https://<funnel-host>/
```

## 持久化與 encryption key

n8n 的 `/home/node/.n8n` 映射到 `lnta_n8n_data` volume。n8n 第一次啟動時會產生 encryption key 並儲存在此 volume；因此不能只備份 workflow JSON 而丟失 volume。

在建立正式 LINE/Gemini Credentials 前，先完成 volume 備份方式。V0 本機階段不把 encryption key 寫入 repository 或 `.env`。

## Code node 隔離

乾淨環境在建立正式 LINE/Gemini credentials 前，原定安全 gate 是擇一完成：

1. 加入同版本 `n8nio/runners` sidecar 並改用 external runner；或
2. 不使用 Code node，以 Crypto、Set、IF、Switch 與 Structured Output Parser 完成 V0，並排除 Code node。

既有 V0 workflow 仍使用 internal JavaScript runner，且曾綁定 credentials；這是已知的待補強項目。長期無人值守前，應加入同版本 external runner 或逐步移除 Code nodes，詳見 `PROJECT_STATUS_AND_USAGE.md`。

## 預設資源與日誌

- n8n：1 CPU / 1 GiB memory。
- nginx：0.25 CPU / 128 MiB memory。
- Docker logs：n8n 最多 3 × 10 MiB，nginx 最多 3 × 5 MiB。
- nginx access log 只保留時間、status、method 與 path，不記錄 query、headers 或 body。
