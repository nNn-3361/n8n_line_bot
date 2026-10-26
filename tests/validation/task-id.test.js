'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createTaskId,
  normalizeTaskId,
} = require('../../src/validation/task-id');

test('task ID is deterministic and uses the documented format', () => {
  assert.equal(createTaskId('event-001'), 'T708EA4DEF782');
  assert.equal(createTaskId('event-001'), createTaskId('event-001'));
  assert.match(createTaskId('event-002'), /^T[0-9A-F]{12}$/u);
  assert.notEqual(createTaskId('event-001'), createTaskId('event-002'));
});

test('task ID rejects missing event IDs', () => {
  assert.throws(() => createTaskId(''), TypeError);
  assert.throws(() => createTaskId(null), TypeError);
});

test('task ID normalization accepts lowercase but rejects malformed IDs', () => {
  assert.equal(normalizeTaskId(' t708ea4def782 '), 'T708EA4DEF782');
  assert.equal(normalizeTaskId('T12345678'), null);
  assert.equal(normalizeTaskId('T708EA4DEF78Z'), null);
});
