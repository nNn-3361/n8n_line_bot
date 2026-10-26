'use strict';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const TASK_ID_PATTERN = /^T[0-9A-F]{12}$/u;

function taipeiDayStart(now, dayOffset) {
  const shifted = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  const utc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + dayOffset,
  ) - TAIPEI_OFFSET_MS;
  return new Date(utc).toISOString();
}

function buildTaskQuery(input, now = new Date()) {
  if (!input || input.intent !== 'list_tasks') {
    throw new TypeError('list_tasks intent is required');
  }
  if (!['today', 'tomorrow', 'pending'].includes(input.query_range)) {
    throw new TypeError('query_range is invalid');
  }
  if (!/^U[0-9a-f]{32}$/iu.test(input.line_user_id)) {
    throw new TypeError('verified LINE user ID is required');
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date');
  }

  const labels = {
    today: '今天',
    tomorrow: '明天',
    pending: '未完成',
  };
  const dated = input.query_range !== 'pending';
  const dayOffset = input.query_range === 'tomorrow' ? 1 : 0;

  return {
    ...input,
    query_status: 'pending',
    query_label: labels[input.query_range],
    range_start: dated ? taipeiDayStart(now, dayOffset) : null,
    range_end: dated ? taipeiDayStart(now, dayOffset + 1) : null,
  };
}

function formatTaipeiDate(value) {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function formatTaskQueryResult(rows, query) {
  if (!Array.isArray(rows)) {
    throw new TypeError('rows must be an array');
  }

  const start = query.range_start ? Date.parse(query.range_start) : null;
  const end = query.range_end ? Date.parse(query.range_end) : null;
  const tasks = rows
    .filter((row) => {
      if (!row || row.line_user_id !== query.line_user_id || row.status !== 'pending') {
        return false;
      }
      if (!TASK_ID_PATTERN.test(row.task_id) || typeof row.title !== 'string' || !row.title.trim()) {
        return false;
      }
      const due = Date.parse(row.due_at);
      if (Number.isNaN(due)) {
        return false;
      }
      return start === null || (due >= start && due < end);
    })
    .sort((left, right) => Date.parse(left.due_at) - Date.parse(right.due_at))
    .slice(0, 50)
    .map((row) => ({
      task_id: row.task_id,
      title: row.title.trim().slice(0, 200),
      due_at: new Date(row.due_at).toISOString(),
      status: 'pending',
    }));

  const replyText = tasks.length === 0
    ? `${query.query_label}沒有待辦事項。`
    : `${query.query_label}待辦事項：\n${tasks.map((task, index) => (
      `${index + 1}. [${task.task_id}] ${task.title}（${formatTaipeiDate(task.due_at)}）`
    )).join('\n')}`;

  return {
    ...query,
    tasks,
    task_count: tasks.length,
    reply_text: replyText,
  };
}

module.exports = {
  buildTaskQuery,
  formatTaskQueryResult,
  taipeiDayStart,
};
