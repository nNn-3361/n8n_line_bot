'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateGeminiIntent } = require('../../src/validation/gemini-intent');
const schema = require('../../src/validation/gemini-intent.schema.json');

const NOW = new Date('2026-10-25T12:00:00+08:00');

function payload(overrides = {}) {
  return {
    intent: 'create_task',
    task_id: null,
    title: '交企劃書',
    due_at: '2026-10-26T15:00:00+08:00',
    query_range: null,
    needs_confirmation: false,
    question: null,
    ...overrides,
  };
}

test('accepts a valid future create_task', () => {
  const result = validateGeminiIntent(payload(), { now: NOW });

  assert.equal(result.valid, true);
  assert.equal(result.can_write, true);
  assert.equal(result.data.intent, 'create_task');
  assert.equal(result.data.title, '交企劃書');
});

test('accepts JSON text and sanitizes model-supplied authority fields', () => {
  const result = validateGeminiIntent(JSON.stringify(payload({
    line_user_id: 'attacker',
    reply_token: 'stolen',
    url: 'https://evil.example',
    method: 'DELETE',
    headers: { Authorization: 'secret' },
    credential: 'production',
  })), { now: NOW });

  assert.equal(result.valid, true);
  assert.equal(result.can_write, true);
  assert.equal(Object.hasOwn(result.data, 'line_user_id'), false);
  assert.equal(Object.hasOwn(result.data, 'reply_token'), false);
  assert.equal(Object.hasOwn(result.data, 'url'), false);
  assert.equal(Object.hasOwn(result.data, 'headers'), false);
  assert.equal(Object.hasOwn(result.data, 'credential'), false);
});

test('rejects unknown intents and invalid JSON', () => {
  assert.equal(validateGeminiIntent(payload({ intent: 'delete_all' }), { now: NOW }).can_write, false);
  assert.equal(validateGeminiIntent('{invalid json', { now: NOW }).error_code, 'invalid_json');
  assert.equal(validateGeminiIntent([], { now: NOW }).can_write, false);
});

test('requires the complete contract and correct primitive types', () => {
  const missingQuestion = payload();
  delete missingQuestion.question;

  assert.equal(
    validateGeminiIntent(missingQuestion, { now: NOW }).error_code,
    'invalid_contract_shape',
  );
  assert.equal(
    validateGeminiIntent(payload({ task_id: 123 }), { now: NOW }).error_code,
    'invalid_contract_shape',
  );
});

test('rejects missing, timezone-free, invalid, or past due dates', () => {
  const invalidValues = [
    null,
    '2026-10-26T15:00:00',
    'not-a-date',
    '2026-02-30T15:00:00+08:00',
    '2026-10-26T15:00:00+14:30',
    '2026-10-24T15:00:00+08:00',
  ];

  for (const dueAt of invalidValues) {
    const result = validateGeminiIntent(payload({ due_at: dueAt }), { now: NOW });
    assert.equal(result.error_code, 'invalid_due_at');
    assert.equal(result.can_write, false);
  }
});

test('JSON schema is closed and requires the complete allowlisted contract', () => {
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    'intent',
    'task_id',
    'title',
    'due_at',
    'query_range',
    'needs_confirmation',
    'question',
  ]);
  assert.deepEqual(schema.properties.intent.enum, [
    'create_task',
    'list_tasks',
    'complete_task',
    'cancel_task',
    'help',
    'unknown',
  ]);
});

test('confirmation requires a question and always blocks writes', () => {
  const confirmed = validateGeminiIntent(payload({
    needs_confirmation: true,
    question: '請問是 10 月 26 日下午三點嗎？',
  }), { now: NOW });
  const missingQuestion = validateGeminiIntent(payload({
    needs_confirmation: true,
    question: null,
  }), { now: NOW });

  assert.equal(confirmed.valid, true);
  assert.equal(confirmed.can_write, false);
  assert.equal(confirmed.data.needs_confirmation, true);
  assert.equal(missingQuestion.error_code, 'missing_confirmation_question');
  assert.equal(missingQuestion.can_write, false);
});

test('complete/cancel require a valid task ID', () => {
  const complete = validateGeminiIntent(payload({
    intent: 'complete_task',
    task_id: 't708ea4def782',
    title: null,
    due_at: null,
  }), { now: NOW });
  const invalid = validateGeminiIntent(payload({
    intent: 'cancel_task',
    task_id: 'T12345678',
    title: null,
    due_at: null,
  }), { now: NOW });

  assert.equal(complete.data.task_id, 'T708EA4DEF782');
  assert.equal(complete.can_write, true);
  assert.equal(invalid.error_code, 'invalid_task_id');
  assert.equal(invalid.can_write, false);
});

test('list_tasks only accepts allowlisted ranges', () => {
  const valid = validateGeminiIntent(payload({
    intent: 'list_tasks',
    title: null,
    due_at: null,
    query_range: 'tomorrow',
  }), { now: NOW });
  const invalid = validateGeminiIntent(payload({
    intent: 'list_tasks',
    title: null,
    due_at: null,
    query_range: 'all_users',
  }), { now: NOW });

  assert.equal(valid.valid, true);
  assert.equal(valid.can_write, false);
  assert.equal(invalid.error_code, 'invalid_query_range');
});

test('text length limits fail closed', () => {
  const result = validateGeminiIntent(payload({ title: 'x'.repeat(201) }), { now: NOW });

  assert.equal(result.error_code, 'text_too_long');
  assert.equal(result.can_write, false);
});
