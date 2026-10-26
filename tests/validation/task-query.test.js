'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTaskQuery,
  formatTaskQueryResult,
} = require('../../src/queries/task-query');

const OWNER = `U${'a'.repeat(32)}`;
const OTHER = `U${'b'.repeat(32)}`;
const NOW = new Date('2026-10-25T12:34:56+08:00');

function input(queryRange) {
  return {
    intent: 'list_tasks',
    query_range: queryRange,
    line_user_id: OWNER,
    reply_token: 'LOCAL_REPLY_TOKEN',
  };
}

test('builds exact Asia/Taipei half-open day ranges', () => {
  const today = buildTaskQuery(input('today'), NOW);
  const tomorrow = buildTaskQuery(input('tomorrow'), NOW);

  assert.equal(today.range_start, '2026-10-24T16:00:00.000Z');
  assert.equal(today.range_end, '2026-10-25T16:00:00.000Z');
  assert.equal(tomorrow.range_start, '2026-10-25T16:00:00.000Z');
  assert.equal(tomorrow.range_end, '2026-10-26T16:00:00.000Z');
  assert.equal(today.query_status, 'pending');
});

test('pending query has no date bounds', () => {
  const pending = buildTaskQuery(input('pending'), NOW);

  assert.equal(pending.range_start, null);
  assert.equal(pending.range_end, null);
  assert.equal(pending.query_label, '未完成');
});

test('query rejects invalid range and unverified-looking owner', () => {
  assert.throws(() => buildTaskQuery(input('week'), NOW), /query_range/u);
  assert.throws(() => buildTaskQuery({ ...input('today'), line_user_id: '1234567890' }, NOW), /LINE user ID/u);
});

test('formatting enforces owner, pending status, date range, and stable ordering', () => {
  const query = buildTaskQuery(input('today'), NOW);
  const result = formatTaskQueryResult([
    { task_id: 'T000000000002', line_user_id: OWNER, title: '第二件', due_at: '2026-10-25T17:00:00+08:00', status: 'pending' },
    { task_id: 'T000000000001', line_user_id: OWNER, title: '第一件', due_at: '2026-10-25T09:00:00+08:00', status: 'pending' },
    { task_id: 'T000000000003', line_user_id: OTHER, title: '別人的任務', due_at: '2026-10-25T10:00:00+08:00', status: 'pending' },
    { task_id: 'T000000000004', line_user_id: OWNER, title: '已完成', due_at: '2026-10-25T11:00:00+08:00', status: 'completed' },
    { task_id: 'T000000000005', line_user_id: OWNER, title: '明天', due_at: '2026-10-26T09:00:00+08:00', status: 'pending' },
  ], query);

  assert.equal(result.task_count, 2);
  assert.deepEqual(result.tasks.map((task) => task.task_id), ['T000000000001', 'T000000000002']);
  assert.match(result.reply_text, /第一件/u);
  assert.doesNotMatch(result.reply_text, /別人的任務|已完成|明天/u);
});

test('empty results produce a deterministic message', () => {
  const query = buildTaskQuery(input('today'), NOW);
  const result = formatTaskQueryResult([], query);

  assert.equal(result.task_count, 0);
  assert.equal(result.reply_text, '今天沒有待辦事項。');
});
