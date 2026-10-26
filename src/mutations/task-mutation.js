'use strict';

const { TASK_ID_PATTERN } = require('../validation/task-id');

const OWNER_PATTERN = /^U[0-9a-f]{32}$/iu;
const FINAL_STATUSES = new Set(['completed', 'cancelled']);

function prepareCreateMutation(input, now = new Date()) {
  const due = Date.parse(input?.due_at);
  if (input?.intent !== 'create_task'
    || input.can_write !== true
    || input.needs_confirmation !== false
    || !OWNER_PATTERN.test(input.line_user_id)
    || !TASK_ID_PATTERN.test(input.event_task_id)
    || typeof input.webhook_event_id !== 'string'
    || input.webhook_event_id.length === 0
    || typeof input.title !== 'string'
    || input.title.trim().length === 0
    || input.title.trim().length > 200
    || Number.isNaN(due)
    || due <= now.getTime()) {
    return null;
  }

  return {
    ...input,
    mutation_kind: 'create',
    task_id: input.event_task_id,
    source_event_id: input.webhook_event_id,
    title: input.title.trim(),
    due_at: new Date(due).toISOString(),
    status: 'pending',
    target_status: 'pending',
  };
}

function prepareStatusMutation(input) {
  if (!input
    || !['complete_task', 'cancel_task'].includes(input.intent)
    || input.can_write !== true
    || input.needs_confirmation !== false
    || !OWNER_PATTERN.test(input.line_user_id)
    || !TASK_ID_PATTERN.test(input.task_id)) {
    return null;
  }

  return {
    ...input,
    mutation_kind: 'status_update',
    target_status: input.intent === 'complete_task' ? 'completed' : 'cancelled',
  };
}

function decideStatusMutation(rows, mutation) {
  const matches = rows.filter((row) => row
    && row.task_id === mutation.task_id
    && row.line_user_id === mutation.line_user_id);

  if (matches.length === 0) {
    return {
      ...mutation,
      mutation_allowed: false,
      error_code: 'task_not_found',
      reply_text: `找不到任務 ${mutation.task_id}。`,
    };
  }
  if (matches.length !== 1) {
    return {
      ...mutation,
      mutation_allowed: false,
      error_code: 'duplicate_task_id',
      reply_text: `任務 ${mutation.task_id} 的資料異常，未進行修改。`,
    };
  }

  const row = matches[0];
  if (row.status === mutation.target_status) {
    const state = mutation.target_status === 'completed' ? '完成' : '取消';
    return {
      ...mutation,
      existing_task: row,
      mutation_allowed: false,
      error_code: null,
      reply_text: `任務 ${mutation.task_id} 已經是${state}狀態。`,
    };
  }
  if (row.status !== 'pending') {
    return {
      ...mutation,
      existing_task: row,
      mutation_allowed: false,
      error_code: 'invalid_status_transition',
      reply_text: `任務 ${mutation.task_id} 目前是 ${row.status}，未進行修改。`,
    };
  }

  return {
    ...mutation,
    existing_task: row,
    mutation_allowed: true,
    error_code: null,
    reply_text: null,
  };
}

function formatMutationResult(row, mutation) {
  if (!row
    || row.line_user_id !== mutation.line_user_id
    || row.task_id !== mutation.task_id
    || row.status !== mutation.target_status) {
    return null;
  }

  let replyText;
  if (mutation.mutation_kind === 'create') {
    replyText = `已新增 [${row.task_id}] ${row.title}（${new Date(row.due_at).toISOString()}）`;
  } else {
    const action = mutation.target_status === 'completed' ? '完成' : '取消';
    replyText = `已${action} [${row.task_id}] ${row.title}`;
  }

  return {
    ...mutation,
    task: {
      task_id: row.task_id,
      title: row.title,
      due_at: new Date(row.due_at).toISOString(),
      status: row.status,
    },
    mutation_applied: true,
    reply_text: replyText,
  };
}

module.exports = {
  decideStatusMutation,
  formatMutationResult,
  prepareCreateMutation,
  prepareStatusMutation,
};
