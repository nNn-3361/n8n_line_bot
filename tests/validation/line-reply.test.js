'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FALLBACK_TEXT,
  HELP_TEXT,
  MAX_REPLY_TEXT_LENGTH,
  prepareLineReply,
} = require('../../src/replies/line-reply');

const verifiedInput = {
  verified_by: 'line-webhook-verifier-v1',
  verifier_header: 'line-webhook-verifier-v1',
  reply_token: 'VALID_REPLY_TOKEN',
  security: {
    configuration_ready: true,
    signature_verified: true,
    owner_authorized: true,
    source: 'line_webhook_verifier',
  },
};

test('verified LINE events can use the trusted reply token', () => {
  const result = prepareLineReply({
    ...verifiedInput,
    intent: 'list_tasks',
    reply_text: '今天沒有待辦事項。',
  });

  assert.deepEqual(result, {
    intent: 'list_tasks',
    error_code: null,
    delivery_mode: 'line_reply',
    send_line_reply: true,
    reply_token: 'VALID_REPLY_TOKEN',
    reply_text: '今天沒有待辦事項。',
  });
});

test('manual and incompletely verified events stay in preview mode', () => {
  for (const input of [
    { intent: 'help', reply_token: 'LOCAL_TEST_REPLY_TOKEN', security: { source: 'manual_local_test' } },
    { ...verifiedInput, verifier_header: 'wrong' },
    { ...verifiedInput, security: { ...verifiedInput.security, owner_authorized: false } },
    { ...verifiedInput, reply_token: '' },
  ]) {
    const result = prepareLineReply(input);
    assert.equal(result.send_line_reply, false);
    assert.equal(result.delivery_mode, 'preview');
    assert.equal(result.reply_token, null);
  }
});

test('confirmation, help, and unknown intents receive deterministic text', () => {
  assert.equal(
    prepareLineReply({ needs_confirmation: true, question: '請問要幾點提醒？' }).reply_text,
    '請問要幾點提醒？',
  );
  assert.equal(prepareLineReply({ intent: 'help' }).reply_text, HELP_TEXT);
  assert.equal(prepareLineReply({ intent: 'unknown' }).reply_text, FALLBACK_TEXT);
});

test('reply text is bounded and untrusted authority fields are discarded', () => {
  const result = prepareLineReply({
    ...verifiedInput,
    reply_text: 'x'.repeat(MAX_REPLY_TEXT_LENGTH + 20),
    url: 'https://attacker.example',
    method: 'DELETE',
    headers: { Authorization: 'attacker' },
    recipient: 'someone-else',
  });

  assert.equal(result.reply_text.length, MAX_REPLY_TEXT_LENGTH);
  assert.deepEqual(Object.keys(result), [
    'intent',
    'error_code',
    'delivery_mode',
    'send_line_reply',
    'reply_token',
    'reply_text',
  ]);
});
