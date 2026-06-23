import { diff, computeSummary } from '../lib/diff.js';
import { normalizeText, generateId } from '../utils/common.js';

export function computeDiff(oldContent, newContent) {
  const normalizedOld = normalizeText(oldContent);
  const normalizedNew = normalizeText(newContent);

  if (normalizedOld === normalizedNew) {
    return null;
  }

  const diffLines = diff(normalizedOld, normalizedNew);
  const summary = computeSummary(diffLines);

  return { diffLines, summary };
}

const NUMERIC_TEMPLATES = {
  integer: /(-?\d[\d,]*)/,
  decimal: /(-?[\d,]+\.?\d*)/,
  'with-unit': /(-?[\d,]+\.?\d*)\s*[a-zA-Z%°]+/,
  currency: /[¥$€£₹]\s*([\d,]+\.?\d*)/,
};

// Tokens a page may briefly show while a real value is being (re)fetched.
// In numeric mode these must NOT overwrite the last good snapshot, otherwise
// a page refresh would log a spurious diff and break the numeric trend.
const PLACEHOLDER_TOKENS = new Set([
  '-', '--', '---', '—', '——', '···', '...', '…',
  'n/a', 'na', 'null', 'undefined', 'nan',
  'loading', 'loading...', 'loading…', '加载中', '加载中...', '加载中…',
  '请稍候', '请稍候...', '暂无', '暂无数据', '--:--', '——:——',
]);

export function isPlaceholderReading(text) {
  if (text == null) return true;
  const trimmed = String(text).trim();
  if (trimmed === '') return true;
  const normalized = trimmed.toLowerCase();
  if (PLACEHOLDER_TOKENS.has(normalized)) return true;
  // Pure punctuation/whitespace runs (dashes, dots, middots) with no digit.
  if (/^[\s\-—–·.•*_]+$/.test(trimmed) && !/\d/.test(trimmed)) return true;
  return false;
}

export function isNumericTask(task = {}) {
  return !!task.numericMode && task.numericMode !== 'off';
}

export function extractNumericValue(text, task = {}) {
  if (!isNumericTask(task)) {
    return { isNumeric: false, numericValue: null };
  }
  const mode = task.numericMode;

  let regex;
  if (mode === 'regex' && task.numericRegex) {
    try {
      regex = new RegExp(task.numericRegex);
    } catch {
      return { isNumeric: false, numericValue: null };
    }
  } else if (mode === 'template') {
    regex = NUMERIC_TEMPLATES[task.numericTemplate] || NUMERIC_TEMPLATES['with-unit'];
  } else {
    regex = /(-?[¥$€£₹]?\s*[\d,]+\.?\d*)\s*[a-zA-Z%°]*/;
  }

  const match = String(text).match(regex);
  if (!match) {
    return { isNumeric: false, numericValue: null };
  }
  const captured = match[1] || match[0];
  const stripped = captured.replace(/[¥$€£₹\s,]/g, '');
  const value = parseFloat(stripped);
  if (isNaN(value)) {
    return { isNumeric: false, numericValue: null };
  }
  return { isNumeric: true, numericValue: value };
}

/**
 * Pure decision for a single poll tick. The scheduler maps the returned
 * action onto storage side effects; keeping this side-effect free makes the
 * numeric/placeholder behavior unit-testable without chrome.* APIs.
 *
 * Returns one of:
 *   { action: 'skip', reason }                       — ignore this reading
 *   { action: 'first_snapshot', content, numericPoint }
 *   { action: 'no_change', content }
 *   { action: 'change', content, diffResult, numericPoint, isNumeric, numericValue }
 */
export function decideCheck(task, snapshot, reading) {
  const numeric = isNumericTask(task);

  // In numeric mode a placeholder (e.g. "—", "Loading…") is transient noise:
  // never let it overwrite the last good snapshot or emit a change.
  if (numeric && isPlaceholderReading(reading)) {
    return { action: 'skip', reason: 'placeholder' };
  }

  const { isNumeric, numericValue } = extractNumericValue(reading, task);

  // In numeric mode the only thing worth recording is a number. A reading that
  // carries a label but no value (e.g. "库存: —" while the page re-fetches)
  // must not overwrite the snapshot or be logged as a diff.
  if (numeric && !isNumeric) {
    return { action: 'skip', reason: 'no-value' };
  }

  if (!snapshot) {
    // Record the baseline numeric point so the very first observed change
    // already yields history.length >= 2 and a trend chart can render.
    return {
      action: 'first_snapshot',
      content: reading,
      numericPoint: isNumeric ? numericValue : null,
    };
  }

  const diffResult = computeDiff(snapshot.content, reading);

  if (!diffResult) {
    return { action: 'no_change', content: reading };
  }

  return {
    action: 'change',
    content: reading,
    diffResult,
    isNumeric,
    numericValue,
    numericPoint: isNumeric ? numericValue : null,
  };
}

export function createChangeRecord(task, oldContent, newContent, diffResult, numeric) {
  const { isNumeric, numericValue } =
    numeric || extractNumericValue(newContent, task);
  return {
    id: generateId(),
    taskId: task.id,
    taskName: task.name,
    url: task.url,
    oldContent,
    newContent,
    diff: diffResult.diffLines,
    summary: diffResult.summary,
    detectedAt: Date.now(),
    read: false,
    isNumeric,
    numericValue,
  };
}
