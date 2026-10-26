'use strict';

const VERIFIER_VERSION = 'line-webhook-verifier-v1';
const MAX_REPLY_TEXT_LENGTH = 5000;
const MAX_REPLY_TOKEN_LENGTH = 512;
const HELP_TEXT = '可輸入：今天、明天、未完成、完成 ID、取消 ID，或用自然語言新增含日期與時間的任務。';
const FALLBACK_TEXT = '我還無法理解這則訊息，請輸入「幫助」查看可用格式。';

function normalizeText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

function isVerifiedLineEvent(input) {
  const security = input.security ?? {};
  return input.verified_by === VERIFIER_VERSION
    && input.verifier_header === VERIFIER_VERSION
    && security.configuration_ready === true
    && security.signature_verified === true
    && security.owner_authorized === true
    && security.source === 'line_webhook_verifier';
}

function prepareLineReply(input = {}) {
  let replyText = normalizeText(input.reply_text);
  if (!replyText && input.needs_confirmation === true) {
    replyText = normalizeText(input.question);
  }
  if (!replyText && input.intent === 'help') {
    replyText = HELP_TEXT;
  }
  if (!replyText) {
    replyText = FALLBACK_TEXT;
  }

  replyText = replyText.slice(0, MAX_REPLY_TEXT_LENGTH);
  const replyToken = normalizeText(input.reply_token);
  const sendLineReply = isVerifiedLineEvent(input)
    && replyToken !== null
    && replyToken.length <= MAX_REPLY_TOKEN_LENGTH;

  return {
    intent: typeof input.intent === 'string' ? input.intent : 'unknown',
    error_code: typeof input.error_code === 'string' ? input.error_code : null,
    delivery_mode: sendLineReply ? 'line_reply' : 'preview',
    send_line_reply: sendLineReply,
    reply_token: sendLineReply ? replyToken : null,
    reply_text: replyText,
  };
}

module.exports = {
  FALLBACK_TEXT,
  HELP_TEXT,
  MAX_REPLY_TEXT_LENGTH,
  prepareLineReply,
};
