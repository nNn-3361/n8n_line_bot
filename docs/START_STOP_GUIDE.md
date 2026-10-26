# LINE 任務助理：啟動與關閉流程

> 適用環境：目前這台 Mac、Docker Compose `line` profile、Tailscale Funnel 1.104.2。
> 以下以 `/path/to/n8n_line_bot` 代表你 clone 後的專案資料夾，請依實際位置替換。

## 平時啟動

> 首次 clone 或從舊版升級時，先完成 [`../HANDOFF.md`](../HANDOFF.md) 的「第一次／升級後啟動」；尤其要建立第三個 internal token secret，並把 `LNTA Internal Webhook` credential 綁到既有 workflow。未完成前不要開 Funnel。

### 1. 確認基礎程式已啟動

先確認 Docker Desktop 已完成啟動、Tailscale 已登入並連線，而且電腦目前有網路。

### 2. 進入專案資料夾

```bash
cd /path/to/n8n_line_bot
```

### 3. 啟動三個專案服務

```bash
./scripts/docker-compose.sh --profile line up -d
```

目前 `.env` 使用 LINE verifier，因此一定要包含 `--profile line`。

### 4. 等待並確認服務健康

```bash
./scripts/docker-compose.sh --profile line ps
```

預期看到以下三個服務，狀態最後都應為 `healthy`：

- `lnta-n8n-1`
- `lnta-webhook-proxy-1`
- `lnta-webhook-verifier-1`

剛啟動時可能暫時顯示 `health: starting`。等約 10–30 秒後再執行一次 `ps`。如果任何服務持續重啟或不健康，不要開 Funnel。

### 5. 執行本機安全檢查

```bash
./scripts/verification/check-local-stack.sh
```

最後應顯示：

```text
Local stack verification passed.
```

精確 POST webhook 在沒有 LINE signature 時回傳 `401` 是正常結果，代表請求到達 verifier 後被安全拒絕。

### 6. 開啟公開 Funnel

只有前三個服務都 healthy，而且本機檢查通過後才執行：

```bash
tailscale funnel --bg http://127.0.0.1:8080
```

第一次啟用時，Tailscale 可能要求確認 Funnel 權限；依畫面提示完成即可。

### 7. 確認 Funnel

```bash
tailscale funnel status
```

預期看到 Funnel 為 on，並代理至：

```text
http://127.0.0.1:8080
```

不可代理至 `5678`。`5678` 是 n8n editor，只能在本機開啟：

```text
http://localhost:5678
```

### 8. 最後確認

從允許的 LINE 帳號輸入：

```text
幫助
```

收到一則正常回覆後即可使用。不要把 secret、access token 或 reply token 貼到終端或聊天中。

## 平時關閉

關閉順序是「先切斷公開入口，再停止容器」。

### 1. 關閉並確認 Tailscale Funnel

```bash
tailscale funnel off
tailscale funnel status
```

預期顯示：

```text
No serve config
```

### 2. 停止專案服務

```bash
cd /path/to/n8n_line_bot
./scripts/docker-compose.sh --profile line down
```

這會停止並移除三個專案容器與專案 network，但保留 n8n 資料 volume。

### 3. 確認容器已停止

```bash
./scripts/docker-compose.sh --profile line ps --all
```

預期只看到表頭，沒有任何服務列。

### 4. 必要時確認資料仍在

```bash
docker volume inspect lnta_n8n_data --format '{{.Name}}'
```

預期輸出：

```text
lnta_n8n_data
```

## 快速版

### 啟動

```bash
cd /path/to/n8n_line_bot
./scripts/docker-compose.sh --profile line up -d
./scripts/docker-compose.sh --profile line ps
./scripts/verification/check-local-stack.sh
tailscale funnel --bg http://127.0.0.1:8080
tailscale funnel status
```

### 關閉

```bash
tailscale funnel off
cd /path/to/n8n_line_bot
./scripts/docker-compose.sh --profile line down
tailscale funnel status
./scripts/docker-compose.sh --profile line ps --all
```

## 緊急關閉

若懷疑 credential、Webhook 或公開入口有問題，立即依序執行：

```bash
tailscale funnel off
cd /path/to/n8n_line_bot
./scripts/docker-compose.sh --profile line down
```

接著不要重新啟動。先撤銷或輪替疑似外洩的 LINE/Gemini credentials，確認 Docker secrets 與 n8n Credentials 都已更新，再重跑完整測試。

## 絕對不要使用的關閉方式

不要執行：

```bash
./scripts/docker-compose.sh --profile line down --volumes
docker volume rm lnta_n8n_data
```

這會刪除 `lnta_n8n_data`，可能一起失去任務、Data Table、workflow、credentials 與 n8n encryption key。

也不要直接把 Funnel 指向：

```text
http://127.0.0.1:5678
```

這會繞過專案的 nginx exact-path 防護與 LINE verifier。

## 常見啟動問題

### Docker CLI 找不到或無法連線

啟動 Docker Desktop，等狀態顯示 Engine running，再重試。

### proxy 不健康或持續重啟

確認使用的命令含有 `--profile line`，再查看近期服務 log：

```bash
./scripts/docker-compose.sh --profile line logs --tail=100 webhook-proxy webhook-verifier
```

### verifier 不健康

檢查以下三個檔案是否存在，且權限為 `0600`：

```bash
stat -f '%Sp %N' secrets/line_channel_secret secrets/line_owner_user_id secrets/n8n_internal_webhook_token
```

不要用 `cat` 顯示檔案內容，也不要把內容放到命令參數。

### Funnel 開啟但 LINE 沒回覆

依序確認：

1. 三個容器都是 healthy。
2. 本機安全檢查已通過。
3. `tailscale funnel status` 指向 `127.0.0.1:8080`。
4. LINE Developers 的 Webhook URL 以 `/webhook/line-events` 結尾。
5. n8n workflow 已發佈，且 Gemini、LINE Reply、`LNTA Internal Webhook` credentials 與 `tasks` Data Table 都綁定正確。
