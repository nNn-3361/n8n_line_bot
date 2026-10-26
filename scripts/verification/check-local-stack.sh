#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$project_root"

expect_status() {
  local expected="$1"
  local label="$2"
  shift 2

  local actual
  actual="$(curl --silent --output /dev/null --write-out '%{http_code}' "$@")"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: $label expected HTTP $expected, got $actual" >&2
    return 1
  fi
  echo "PASS: $label -> HTTP $actual"
}

./scripts/docker-compose.sh config --quiet

expect_status 200 "n8n health" http://127.0.0.1:5678/healthz
expect_status 404 "proxy root is closed" http://127.0.0.1:8080/
expect_status 404 "n8n REST is not proxied" http://127.0.0.1:8080/rest
expect_status 404 "test webhook is not proxied" http://127.0.0.1:8080/webhook-test/line-events
expect_status 405 "webhook rejects GET" http://127.0.0.1:8080/webhook/line-events
expect_status 415 "webhook rejects compressed body" \
  -X POST -H 'Content-Encoding: gzip' --data '{}' \
  http://127.0.0.1:8080/webhook/line-events
expect_status 413 "webhook rejects body larger than 2 MiB" \
  -X POST -H 'Content-Type: application/octet-stream' \
  --data-binary @<(head -c 2097153 /dev/zero) \
  http://127.0.0.1:8080/webhook/line-events

valid_path_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X POST -H 'Content-Type: application/json' --data '{"events":[]}' \
  http://127.0.0.1:8080/webhook/line-events)"

case "$valid_path_status" in
  200|401|404)
    echo "PASS: exact POST path reaches verifier/n8n -> HTTP $valid_path_status"
    ;;
  *)
    echo "FAIL: exact POST path returned HTTP $valid_path_status" >&2
    exit 1
    ;;
esac

echo "Local stack verification passed."
