#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

for protected_path in .env secrets/line_channel_secret secrets/line_owner_user_id secrets/n8n_internal_webhook_token; do
  if ! git check-ignore -q "$protected_path"; then
    echo "ERROR: $protected_path is not ignored." >&2
    exit 1
  fi
done

tracked_files="$(git ls-files | grep -v '^\.env\.example$' || true)"
if printf '%s\n' "$tracked_files" | grep -E '(^|/)(\.env($|\.)|secrets/|\.n8n/|n8n_data/|credentials/)|\.(sqlite|db|p12|pfx|jks|keystore|token)$' >/dev/null; then
  echo "ERROR: a protected runtime or credential path is tracked." >&2
  printf '%s\n' "$tracked_files" | grep -E '(^|/)(\.env($|\.)|secrets/|\.n8n/|n8n_data/|credentials/)|\.(sqlite|db|p12|pfx|jks|keystore|token)$' >&2
  exit 1
fi

publishable_files="$(git ls-files -co --exclude-standard | grep -v -E '^(\.env\.example|scripts/verification/check-publication-safety\.sh)$')"
if printf '%s\n' "$publishable_files" | xargs -r grep -IlE '/Users/[^/]+/|https://[^ /]+\.ts\.net' >/dev/null; then
  echo "ERROR: a publishable text file contains a personal absolute path or Tailscale hostname." >&2
  printf '%s\n' "$publishable_files" | xargs -r grep -IlE '/Users/[^/]+/|https://[^ /]+\.ts\.net' >&2
  exit 1
fi

node <<'NODE'
const fs = require('node:fs');
const workflow = JSON.parse(fs.readFileSync('workflows/V0-line-task-assistant.json', 'utf8'));

if (workflow.active !== false) throw new Error('public workflow must remain inactive');
for (const key of ['id', 'versionId']) {
  if (Object.hasOwn(workflow, key)) throw new Error(`workflow must not contain ${key}`);
}

for (const node of workflow.nodes ?? []) {
  if (Object.hasOwn(node, 'webhookId')) throw new Error(`${node.name} contains webhookId`);
  if (node.credentials && Object.keys(node.credentials).length > 0) {
    throw new Error(`${node.name} contains a credential binding`);
  }
  if (node.type === 'n8n-nodes-base.dataTable' && node.parameters?.dataTableId?.value !== '') {
    throw new Error(`${node.name} contains a Data Table instance ID`);
  }
}

const webhook = workflow.nodes.find((node) => node.name === 'LINE Webhook');
if (webhook?.parameters?.authentication !== 'headerAuth') {
  throw new Error('LINE Webhook must require Header Auth');
}
NODE

echo "Publication safety checks passed. Review the staged diff manually before pushing."
