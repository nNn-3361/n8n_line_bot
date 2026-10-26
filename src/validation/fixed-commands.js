'use strict';

const { normalizeTaskId } = require('./task-id');

const LIST_COMMANDS = new Map([
  ['今天', 'today'],
  ['明天', 'tomorrow'],
  ['未完成', 'pending'],
]);

function baseIntent(intent) {
  return {
    intent,
    task_id: null,
    title: null,
    due_at: null,
    query_range: null,
    needs_confirmation: false,
    question: null,
  };
}

/**
 * Return null when Gemini is required. A returned value is already trusted as
 * a fixed command, but identity and owner authorization still happen later.
 */
function parseFixedCommand(input) {
  if (typeof input !== 'string') {
    return null;
  }

  const text = input.trim().replace(/\s+/gu, ' ');
  if (text === '') {
    return null;
  }

  if (LIST_COMMANDS.has(text)) {
    return {
      ...baseIntent('list_tasks'),
      query_range: LIST_COMMANDS.get(text),
      source: 'fixed',
      call_gemini: false,
      can_write: false,
    };
  }

  if (text === '幫助') {
    return {
      ...baseIntent('help'),
      source: 'fixed',
      call_gemini: false,
      can_write: false,
    };
  }

  const mutationMatch = /^(完成|取消)\s+(.+)$/u.exec(text);
  if (!mutationMatch) {
    return null;
  }

  const taskId = normalizeTaskId(mutationMatch[2]);
  if (!taskId) {
    return {
      ...baseIntent('unknown'),
      source: 'fixed',
      call_gemini: false,
      can_write: false,
      error_code: 'invalid_task_id',
    };
  }

  return {
    ...baseIntent(mutationMatch[1] === '完成' ? 'complete_task' : 'cancel_task'),
    task_id: taskId,
    source: 'fixed',
    call_gemini: false,
    can_write: true,
  };
}

module.exports = {
  parseFixedCommand,
};
