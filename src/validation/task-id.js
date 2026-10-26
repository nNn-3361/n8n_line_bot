'use strict';

const { createHash } = require('node:crypto');

const TASK_ID_PATTERN = /^T[0-9A-F]{12}$/u;

/**
 * Derive a stable, user-visible task ID from a verified LINE webhook event ID.
 * The caller must only pass webhookEventId after LINE signature verification.
 */
function createTaskId(webhookEventId) {
  if (typeof webhookEventId !== 'string' || webhookEventId.trim() === '') {
    throw new TypeError('webhookEventId must be a non-empty string');
  }

  const digest = createHash('sha256')
    .update(webhookEventId, 'utf8')
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();

  return `T${digest}`;
}

function normalizeTaskId(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return TASK_ID_PATTERN.test(normalized) ? normalized : null;
}

module.exports = {
  TASK_ID_PATTERN,
  createTaskId,
  normalizeTaskId,
};
