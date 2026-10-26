'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..', '..');
const config = readFileSync(join(root, 'config/reverse-proxy/nginx.line.conf'), 'utf8');
const compose = readFileSync(join(root, 'compose.yaml'), 'utf8');

function serviceBlock(name, nextName, nextIndent = 2) {
  const start = compose.indexOf(`\n  ${name}:`);
  const end = compose.indexOf(`\n${' '.repeat(nextIndent)}${nextName}:`, start + 1);
  assert.notEqual(start, -1, `${name} service is missing`);
  assert.notEqual(end, -1, `${nextName} service boundary is missing`);
  return compose.slice(start, end);
}

test('LINE proxy exposes only the exact public webhook path', () => {
  assert.match(config, /location = \/webhook\/line-events\s*\{/u);
  assert.match(config, /if \(\$request_method != POST\)/u);
  assert.match(config, /location \/\s*\{\s*return 404;/u);
  assert.doesNotMatch(config, /internal-health/u);
  assert.match(config, /client_max_body_size 256k;/u);
  assert.match(config, /fastcgi_temp_path \/tmp\/fastcgi_temp;/u);
  assert.match(config, /uwsgi_temp_path \/tmp\/uwsgi_temp;/u);
  assert.match(config, /scgi_temp_path \/tmp\/scgi_temp;/u);
});

test('LINE proxy forwards the original signature and content type to verifier', () => {
  assert.match(config, /server webhook-verifier:3000;/u);
  assert.match(config, /proxy_set_header X-Line-Signature \$http_x_line_signature;/u);
  assert.match(config, /proxy_set_header Content-Type \$http_content_type;/u);
  assert.match(config, /proxy_pass http:\/\/line_verifier\/line-events;/u);
  assert.doesNotMatch(config, /proxy_pass http:\/\/n8n/u);
});

test('internal webhook token is mounted only into the verifier service', () => {
  const n8n = serviceBlock('n8n', 'webhook-verifier');
  const verifier = serviceBlock('webhook-verifier', 'webhook-proxy');
  const proxy = serviceBlock('webhook-proxy', 'networks', 0);

  assert.doesNotMatch(n8n, /n8n_internal_webhook_token/u);
  assert.match(verifier, /N8N_INTERNAL_WEBHOOK_TOKEN_FILE: \/run\/secrets\/n8n_internal_webhook_token/u);
  assert.match(verifier, /^\s+- n8n_internal_webhook_token$/mu);
  assert.doesNotMatch(proxy, /n8n_internal_webhook_token/u);
  assert.match(
    compose,
    /^  n8n_internal_webhook_token:\n    file: \.\/secrets\/n8n_internal_webhook_token$/mu,
  );
});
