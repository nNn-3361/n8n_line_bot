'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  decideStatusMutation,
  formatMutationResult,
  prepareCreateMutation,
  prepareStatusMutation,
} = require('../../src/mutations/task-mutation');

const OWNER = `U${'a'.repeat(32)}`;
const OTHER = `U${'b'.repeat(32)}`;
const TASK_ID = 'T123456789ABC';
const NOW = new Date('2026-10-25T12:00:00+08:00');

test('create mutation derives authority fields from verified input', () => {
  const mutation = prepareCreateMutation({
    intent: 'create_task',
    can_write: true,
    needs_confirmation: false,
    event_task_id: TASK_ID,
    webhook_event_id: 'EVENT-001',
    line_user_id: OWNER,
    title: '  交企劃書  ',
    due_at: '2026-10-26T15:00:00+08:00',
  }, NOW);

  assert.equal(mutation.task_id, TASK_ID);
  assert.equal(mutation.source_event_id, 'EVENT-001');
  assert.equal(mutation.line_user_id, OWNER);
  assert.equal(mutation.status, 'pending');
  assert.equal(mutation.title, '交企劃書');
});

test('create mutation fails closed for confirmation, stale due date, or invalid owner', () => {
  const base = {
    intent: 'create_task', can_write: true, needs_confirmation: false,
    event_task_id: TASK_ID, webhook_event_id: 'EVENT-001', line_user_id: OWNER,
    title: '交企劃書', due_at: '2026-10-26T15:00:00+08:00',
  };
  assert.equal(prepareCreateMutation({ ...base, needs_confirmation: true }, NOW), null);
  assert.equal(prepareCreateMutation({ ...base, due_at: '2026-10-24T15:00:00+08:00' }, NOW), null);
  assert.equal(prepareCreateMutation({ ...base, line_user_id: '1234567890' }, NOW), null);
});

test('status mutation maps intent to an allowlisted target status', () => {
  const complete = prepareStatusMutation({
    intent: 'complete_task', can_write: true, needs_confirmation: false,
    line_user_id: OWNER, task_id: TASK_ID,
  });
  const cancel = prepareStatusMutation({
    intent: 'cancel_task', can_write: true, needs_confirmation: false,
    line_user_id: OWNER, task_id: TASK_ID,
  });
  assert.equal(complete.target_status, 'completed');
  assert.equal(cancel.target_status, 'cancelled');
});

test('status decision requires exactly one owner-scoped pending row', () => {
  const mutation = prepareStatusMutation({
    intent: 'complete_task', can_write: true, needs_confirmation: false,
    line_user_id: OWNER, task_id: TASK_ID,
  });
  const otherRow = { task_id: TASK_ID, line_user_id: OTHER, status: 'pending' };
  assert.equal(decideStatusMutation([otherRow], mutation).error_code, 'task_not_found');

  const pending = { task_id: TASK_ID, line_user_id: OWNER, status: 'pending', title: '任務' };
  assert.equal(decideStatusMutation([pending], mutation).mutation_allowed, true);
  assert.equal(decideStatusMutation([pending, pending], mutation).error_code, 'duplicate_task_id');
});

test('repeated or conflicting status changes do not write', () => {
  const mutation = prepareStatusMutation({
    intent: 'complete_task', can_write: true, needs_confirmation: false,
    line_user_id: OWNER, task_id: TASK_ID,
  });
  const completed = decideStatusMutation([
    { task_id: TASK_ID, line_user_id: OWNER, status: 'completed' },
  ], mutation);
  const cancelled = decideStatusMutation([
    { task_id: TASK_ID, line_user_id: OWNER, status: 'cancelled' },
  ], mutation);
  assert.equal(completed.mutation_allowed, false);
  assert.equal(completed.error_code, null);
  assert.equal(cancelled.error_code, 'invalid_status_transition');
});

test('mutation result refuses a row from another owner', () => {
  const mutation = {
    mutation_kind: 'status_update', target_status: 'completed',
    line_user_id: OWNER, task_id: TASK_ID,
  };
  const row = {
    task_id: TASK_ID, line_user_id: OTHER, title: '別人的任務',
    due_at: '2026-10-26T15:00:00+08:00', status: 'completed',
  };
  assert.equal(formatMutationResult(row, mutation), null);
});
