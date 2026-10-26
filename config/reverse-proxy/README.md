# Reverse proxy configuration

這裡將放置 exact-path reverse proxy 設定。唯一可公開的路徑為 `POST /webhook/line-events`。

`nginx.line.conf` 將請求以未改寫的 body 轉給 verifier，並包含 256 KiB body limit、header limit、rate/connection limit、timeout、compressed-body rejection 與最小化 access log。它不會直接代理到 n8n。
