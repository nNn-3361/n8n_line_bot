'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const workflow = require('../../workflows/V0-line-task-assistant.json');

function node(name) {
  return workflow.nodes.find((candidate) => candidate.name === name);
}

test('workflow export stays unpublished and credential-free', () => {
  assert.equal(workflow.active, false);
  assert.equal(workflow.nodes.some((candidate) => candidate.credentials), false);
  assert.equal(Object.hasOwn(workflow, 'id'), false);
  assert.equal(Object.hasOwn(workflow, 'versionId'), false);
  assert.equal(workflow.nodes.some((candidate) => Object.hasOwn(candidate, 'webhookId')), false);

  const serialized = JSON.stringify(workflow);
  assert.doesNotMatch(serialized, /U[0-9a-f]{32}/iu);
  assert.doesNotMatch(serialized, /Bearer\s+[A-Za-z0-9._~-]{20,}/u);
  assert.doesNotMatch(serialized, /AIza[0-9A-Za-z_-]{30,}/u);
  const externalUrls = workflow.nodes
    .map((candidate) => candidate.parameters?.url)
    .filter((value) => typeof value === 'string' && /^https?:\/\//u.test(value));
  assert.deepEqual([...new Set(externalUrls)], [
    'https://api.line.me/v2/bot/message/reply',
  ]);
});

test('internal n8n webhook is POST-only, exact-path, and immediate-response', () => {
  const webhook = node('LINE Webhook');

  assert.equal(webhook.type, 'n8n-nodes-base.webhook');
  assert.equal(webhook.parameters.httpMethod, 'POST');
  assert.equal(webhook.parameters.path, 'line-events-internal');
  assert.equal(webhook.parameters.authentication, 'headerAuth');
  assert.equal(webhook.parameters.responseMode, 'onReceived');
  assert.equal(webhook.parameters.options.rawBody, undefined);
  assert.equal(webhook.parameters.options.responseCode, 200);
});

test('internal path accepts only the verifier envelope and remains fail-closed', () => {
  const normalizer = node('Normalize LINE Request');
  const gate = node('Security Gate (Fail Closed)');

  assert.match(normalizer.parameters.jsCode, /line-webhook-verifier-v1/u);
  assert.match(normalizer.parameters.jsCode, /x-lnta-verifier-version/u);
  assert.match(normalizer.parameters.jsCode, /line_webhook_verifier/u);
  assert.match(normalizer.parameters.jsCode, /message_text.length <= 500/u);
  assert.match(normalizer.parameters.jsCode, /body\.event_task_id/u);
  assert.match(normalizer.parameters.jsCode, /T\[0-9A-F\]\{12\}/u);
  assert.match(gate.parameters.jsCode, /verified_by !== expectedVerifier/u);
  assert.match(gate.parameters.jsCode, /owner_authorized !== true/u);
  assert.match(gate.parameters.jsCode, /return \[\];/u);
  assert.deepEqual(
    workflow.connections['LINE Webhook'].main[0][0].node,
    'Normalize LINE Request',
  );
  assert.deepEqual(
    workflow.connections['Normalize LINE Request'].main[0][0].node,
    'Security Gate (Fail Closed)',
  );
});

test('manual path uses fake identity and routes fixed commands before Gemini', () => {
  const mock = node('Mock Verified LINE Event');
  const route = node('Intent Route');

  assert.match(mock.parameters.jsCode, /'0'\.repeat\(32\)/u);
  assert.match(mock.parameters.jsCode, /message_text: '今天'/u);
  assert.equal(route.parameters.mode, 'expression');
  assert.equal(route.parameters.numberOutputs, 2);
  assert.deepEqual(workflow.connections['Intent Route'].main[0][0].node, 'Fixed Intent Action');
  assert.deepEqual(workflow.connections['Intent Route'].main[1][0].node, 'Google Gemini Intent');
});

test('Gemini is JSON-only, tool-free, and locally revalidated before routing', () => {
  const gemini = node('Google Gemini Intent');
  const validator = node('Validate Gemini Intent');
  const action = node('Fixed Intent Action');

  assert.equal(gemini.type, '@n8n/n8n-nodes-langchain.googleGemini');
  assert.equal(gemini.typeVersion, 1.1);
  assert.equal(gemini.parameters.resource, 'text');
  assert.equal(gemini.parameters.operation, 'message');
  assert.equal(gemini.parameters.modelId.value, 'models/gemini-3.5-flash-lite');
  assert.equal(gemini.parameters.jsonOutput, true);
  assert.deepEqual(gemini.parameters.builtInTools, {});
  assert.equal(gemini.parameters.options.temperature, 0);
  assert.equal(gemini.parameters.options.candidateCount, 1);
  assert.equal(gemini.parameters.options.thinkingBudget, undefined);
  assert.equal(gemini.parameters.options.maxToolsIterations, 1);
  assert.match(gemini.parameters.options.systemMessage, /untrusted data/u);
  assert.match(gemini.parameters.options.systemMessage, /exactly these seven keys/u);
  assert.match(gemini.parameters.options.systemMessage, /never output user IDs/iu);
  assert.equal(gemini.onError, 'continueRegularOutput');

  assert.match(validator.parameters.jsCode, /JSON\.parse\(raw\)/u);
  assert.match(validator.parameters.jsCode, /allowedIntents/u);
  assert.match(validator.parameters.jsCode, /fields\.every/u);
  assert.match(validator.parameters.jsCode, /timestamp > Date\.now\(\)/u);
  assert.match(validator.parameters.jsCode, /can_write: false/u);
  assert.match(validator.parameters.jsCode, /intent_source: 'gemini_rejected'/u);
  assert.match(action.parameters.output, /\$json\.can_write === true/u);
  assert.match(action.parameters.output, /\$json\.needs_confirmation === false/u);
  assert.deepEqual(workflow.connections['Google Gemini Intent'].main[0][0].node, 'Validate Gemini Intent');
  assert.deepEqual(workflow.connections['Validate Gemini Intent'].main[0][0].node, 'Fixed Intent Action');
});

test('list queries are owner-scoped in Data Table and defense-in-depth formatting', () => {
  const pending = node('Get Pending Tasks');
  const dated = node('Get Dated Tasks');
  const formatter = node('Format Task Query Result');

  for (const dataTableNode of [pending, dated]) {
    assert.equal(dataTableNode.type, 'n8n-nodes-base.dataTable');
    assert.equal(dataTableNode.typeVersion, 1.1);
    assert.equal(dataTableNode.parameters.operation, 'get');
    assert.equal(dataTableNode.parameters.dataTableId.value, '');
    assert.equal(dataTableNode.parameters.matchType, 'allConditions');
    assert.equal(dataTableNode.parameters.limit, 50);
    assert.equal(dataTableNode.parameters.orderByColumn, 'due_at');
    const filters = dataTableNode.parameters.filters.conditions;
    assert.deepEqual(filters.slice(0, 2), [
      { keyName: 'line_user_id', condition: 'eq', keyValue: '={{ $json.line_user_id }}' },
      { keyName: 'status', condition: 'eq', keyValue: 'pending' },
    ]);
  }

  assert.deepEqual(
    dated.parameters.filters.conditions.slice(2),
    [
      { keyName: 'due_at', condition: 'gte', keyValue: '={{ $json.range_start }}' },
      { keyName: 'due_at', condition: 'lt', keyValue: '={{ $json.range_end }}' },
    ],
  );
  assert.match(formatter.parameters.jsCode, /row\.line_user_id !== query\.line_user_id/u);
  assert.match(formatter.parameters.jsCode, /row\.status !== 'pending'/u);
  assert.match(formatter.parameters.jsCode, /due >= start && due < end/u);
});

test('mutations are owner-scoped, idempotent, and restricted to safe transitions', () => {
  const dataTableNodes = workflow.nodes.filter((candidate) => candidate.type === 'n8n-nodes-base.dataTable');
  assert.deepEqual(
    dataTableNodes.map((candidate) => candidate.parameters.operation),
    ['get', 'get', 'upsert', 'get', 'update'],
  );

  const prepare = node('Prepare Task Mutation');
  const upsert = node('Upsert Created Task');
  const find = node('Find Task for Mutation');
  const decide = node('Decide Status Mutation');
  const update = node('Update Task Status');

  assert.match(prepare.parameters.jsCode, /input\.can_write === true/u);
  assert.match(prepare.parameters.jsCode, /input\.needs_confirmation === false/u);
  assert.match(prepare.parameters.jsCode, /input\.event_task_id/u);
  assert.match(prepare.parameters.jsCode, /complete_task: 'completed'/u);
  assert.match(prepare.parameters.jsCode, /cancel_task: 'cancelled'/u);

  assert.equal(upsert.parameters.operation, 'upsert');
  assert.equal(upsert.parameters.matchType, 'allConditions');
  assert.deepEqual(upsert.parameters.filters.conditions, [
    { keyName: 'source_event_id', condition: 'eq', keyValue: '={{ $json.source_event_id }}' },
    { keyName: 'line_user_id', condition: 'eq', keyValue: '={{ $json.line_user_id }}' },
  ]);
  assert.equal(upsert.parameters.columns.value.task_id, '={{ $json.task_id }}');
  assert.equal(upsert.parameters.columns.value.line_user_id, '={{ $json.line_user_id }}');
  assert.equal(upsert.parameters.columns.value.status, 'pending');

  assert.deepEqual(find.parameters.filters.conditions, [
    { keyName: 'task_id', condition: 'eq', keyValue: '={{ $json.task_id }}' },
    { keyName: 'line_user_id', condition: 'eq', keyValue: '={{ $json.line_user_id }}' },
  ]);
  assert.equal(find.parameters.limit, 2);
  assert.match(decide.parameters.jsCode, /rows\.length !== 1/u);
  assert.match(decide.parameters.jsCode, /row\.status !== 'pending'/u);
  assert.match(decide.parameters.jsCode, /row\.line_user_id === mutation\.line_user_id/u);

  assert.equal(update.parameters.operation, 'update');
  assert.equal(update.parameters.matchType, 'allConditions');
  assert.deepEqual(update.parameters.filters.conditions, [
    { keyName: 'task_id', condition: 'eq', keyValue: '={{ $json.task_id }}' },
    { keyName: 'line_user_id', condition: 'eq', keyValue: '={{ $json.line_user_id }}' },
    { keyName: 'status', condition: 'eq', keyValue: 'pending' },
  ]);
  assert.equal(update.parameters.columns.value.status, '={{ $json.target_status }}');

  assert.deepEqual(
    workflow.connections['Fixed Intent Action'].main[1][0].node,
    'Prepare Task Mutation',
  );
});

test('LINE reply delivery is fixed, credential-backed, and fail-closed', () => {
  const prepare = node('Prepare LINE Reply');
  const route = node('Reply Delivery Route');
  const send = node('Send LINE Reply');

  assert.match(prepare.parameters.jsCode, /line-webhook-verifier-v1/u);
  assert.match(prepare.parameters.jsCode, /security\.signature_verified === true/u);
  assert.match(prepare.parameters.jsCode, /security\.owner_authorized === true/u);
  assert.match(prepare.parameters.jsCode, /security\.source === 'line_webhook_verifier'/u);
  assert.match(prepare.parameters.jsCode, /replyText\.slice\(0, 5000\)/u);
  assert.match(prepare.parameters.jsCode, /reply_token: sendLineReply \? replyToken : null/u);

  assert.equal(route.parameters.mode, 'expression');
  assert.equal(route.parameters.numberOutputs, 2);
  assert.match(route.parameters.output, /send_line_reply === true/u);

  assert.equal(send.type, 'n8n-nodes-base.httpRequest');
  assert.equal(send.parameters.method, 'POST');
  assert.equal(send.parameters.url, 'https://api.line.me/v2/bot/message/reply');
  assert.equal(send.parameters.authentication, 'genericCredentialType');
  assert.equal(send.parameters.genericAuthType, 'httpHeaderAuth');
  assert.equal(send.parameters.rawContentType, 'application/json');
  assert.match(send.parameters.body, /replyToken: \$json\.reply_token/u);
  assert.match(send.parameters.body, /type: 'text'/u);
  assert.match(send.parameters.body, /text: \$json\.reply_text/u);
  assert.equal(send.parameters.options.timeout, 10000);
  assert.equal(send.parameters.options.redirect.redirect.followRedirects, false);

  for (const source of [
    'Format Task Query Result',
    'Mutation No Write',
    'Format Mutation Result',
    'Fixed Intent Ready',
  ]) {
    assert.equal(workflow.connections[source].main[0][0].node, 'Prepare LINE Reply');
  }
  assert.equal(workflow.connections['Prepare LINE Reply'].main[0][0].node, 'Reply Delivery Route');
  assert.equal(workflow.connections['Reply Delivery Route'].main[0][0].node, 'Send LINE Reply');
  assert.equal(workflow.connections['Reply Delivery Route'].main[1][0].node, 'Validated Intent Preview');
  assert.equal(workflow.settings.saveDataSuccessExecution, 'none');
  assert.equal(workflow.settings.saveDataErrorExecution, 'none');
});
