'use strict';

const { normalizeTaskId } = require('./task-id');

const ALLOWED_INTENTS = new Set([
  'create_task',
  'list_tasks',
  'complete_task',
  'cancel_task',
  'help',
  'unknown',
]);

const ALLOWED_QUERY_RANGES = new Set(['today', 'tomorrow', 'pending']);
const ISO_WITH_TIMEZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/u;
const MAX_TEXT_LENGTH = 200;
const CONTRACT_FIELDS = [
  'intent',
  'task_id',
  'title',
  'due_at',
  'query_range',
  'needs_confirmation',
  'question',
];

function safeIntent(errorCode) {
  return {
    valid: false,
    can_write: false,
    error_code: errorCode,
    data: {
      intent: 'unknown',
      task_id: null,
      title: null,
      due_at: null,
      query_range: null,
      needs_confirmation: false,
      question: null,
    },
  };
}

function parsePayload(payload) {
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }

  return payload;
}

function normalizeNullableText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

function isNullableString(value) {
  return value === null || typeof value === 'string';
}

function hasValidContractShape(value) {
  if (!CONTRACT_FIELDS.every((field) => Object.hasOwn(value, field))) {
    return false;
  }

  return isNullableString(value.task_id)
    && isNullableString(value.title)
    && isNullableString(value.due_at)
    && isNullableString(value.query_range)
    && typeof value.needs_confirmation === 'boolean'
    && isNullableString(value.question);
}

function daysInMonth(year, month) {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isValidFutureDateTime(value, now) {
  if (typeof value !== 'string') {
    return false;
  }

  const match = ISO_WITH_TIMEZONE.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === 'Z' ? 0 : Number(match[10]);
  const offsetMinute = match[8] === 'Z' ? 0 : Number(match[11]);

  if (month < 1 || month > 12
    || day < 1 || day > daysInMonth(year, month)
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHour > 14
    || offsetMinute > 59
    || (offsetHour === 14 && offsetMinute !== 0)) {
    return false;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

/**
 * Validate and sanitize Gemini output. Only allowlisted fields are copied to
 * the result, so model-supplied identity, endpoint, headers, and credentials
 * can never cross this boundary.
 */
function validateGeminiIntent(payload, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const parsed = parsePayload(payload);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return safeIntent('invalid_json');
  }

  if (!hasValidContractShape(parsed)) {
    return safeIntent('invalid_contract_shape');
  }

  if (!ALLOWED_INTENTS.has(parsed.intent)) {
    return safeIntent('invalid_intent');
  }
  const title = normalizeNullableText(parsed.title);
  const question = normalizeNullableText(parsed.question);
  const taskId = normalizeTaskId(parsed.task_id);
  const queryRange = ALLOWED_QUERY_RANGES.has(parsed.query_range)
    ? parsed.query_range
    : null;

  if ((title && title.length > MAX_TEXT_LENGTH) || (question && question.length > MAX_TEXT_LENGTH)) {
    return safeIntent('text_too_long');
  }

  if (parsed.needs_confirmation) {
    if (!question) {
      return safeIntent('missing_confirmation_question');
    }

    return {
      valid: true,
      can_write: false,
      error_code: null,
      data: {
        intent: parsed.intent,
        task_id: taskId,
        title,
        due_at: null,
        query_range: queryRange,
        needs_confirmation: true,
        question,
      },
    };
  }

  if (parsed.intent === 'create_task') {
    if (!title) {
      return safeIntent('missing_title');
    }
    if (!isValidFutureDateTime(parsed.due_at, now)) {
      return safeIntent('invalid_due_at');
    }

    return {
      valid: true,
      can_write: true,
      error_code: null,
      data: {
        intent: 'create_task',
        task_id: null,
        title,
        due_at: parsed.due_at,
        query_range: null,
        needs_confirmation: false,
        question: null,
      },
    };
  }

  if (parsed.intent === 'complete_task' || parsed.intent === 'cancel_task') {
    if (!taskId) {
      return safeIntent('invalid_task_id');
    }

    return {
      valid: true,
      can_write: true,
      error_code: null,
      data: {
        intent: parsed.intent,
        task_id: taskId,
        title: null,
        due_at: null,
        query_range: null,
        needs_confirmation: false,
        question: null,
      },
    };
  }

  if (parsed.intent === 'list_tasks') {
    if (!queryRange) {
      return safeIntent('invalid_query_range');
    }

    return {
      valid: true,
      can_write: false,
      error_code: null,
      data: {
        intent: 'list_tasks',
        task_id: null,
        title: null,
        due_at: null,
        query_range: queryRange,
        needs_confirmation: false,
        question: null,
      },
    };
  }

  return {
    valid: true,
    can_write: false,
    error_code: null,
    data: {
      intent: parsed.intent,
      task_id: null,
      title: null,
      due_at: null,
      query_range: null,
      needs_confirmation: false,
      question: null,
    },
  };
}

module.exports = {
  ALLOWED_INTENTS,
  ALLOWED_QUERY_RANGES,
  ISO_WITH_TIMEZONE,
  validateGeminiIntent,
};
