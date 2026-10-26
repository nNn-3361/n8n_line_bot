'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseFixedCommand } = require('../../src/validation/fixed-commands');

test('list and help commands bypass Gemini', () => {
  assert.deepEqual(
    ['今天', '明天', '未完成'].map((text) => parseFixedCommand(text).query_range),
    ['today', 'tomorrow', 'pending'],
  );
  assert.equal(parseFixedCommand('幫助').intent, 'help');
  assert.equal(parseFixedCommand(' 今天 ').call_gemini, false);
});

test('complete and cancel commands normalize valid task IDs', () => {
  const complete = parseFixedCommand('完成 t708ea4def782');
  const cancel = parseFixedCommand('取消   T708EA4DEF782');

  assert.equal(complete.intent, 'complete_task');
  assert.equal(complete.task_id, 'T708EA4DEF782');
  assert.equal(complete.can_write, true);
  assert.equal(cancel.intent, 'cancel_task');
  assert.equal(cancel.task_id, 'T708EA4DEF782');
});

test('malformed mutation commands fail closed without calling Gemini', () => {
  const result = parseFixedCommand('完成 T12345678');

  assert.equal(result.intent, 'unknown');
  assert.equal(result.error_code, 'invalid_task_id');
  assert.equal(result.can_write, false);
  assert.equal(result.call_gemini, false);
});

test('other natural language is delegated to Gemini', () => {
  assert.equal(parseFixedCommand('後天下午三點交企劃書'), null);
  assert.equal(parseFixedCommand(''), null);
  assert.equal(parseFixedCommand(null), null);
});
