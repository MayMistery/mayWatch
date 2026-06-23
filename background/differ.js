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

function extractNumericValue(text, task = {}) {
  const mode = task.numericMode || 'off';

  if (mode === 'off') {
    return { isNumeric: false, numericValue: null };
  }

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

  const match = text.match(regex);
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

const PLACEHOLDER_PATTERNS = [
  /^--$/,
  /^-$/,
  /^—$/,
  /^loading\.\.\.$/i,
  /^n\/a$/i,
  /^null$/i,
  /^undefined$/i,
  /^正在加载/i,
  /^加载中/i,
  /^刷新中/i,
  /^\s*$/,
];

export function isPlaceholderContent(text) {
  const trimmed = text.trim();
  return PLACEHOLDER_PATTERNS.some(p => p.test(trimmed));
}

export function createChangeRecord(task, oldContent, newContent, diffResult) {
  const { isNumeric, numericValue } = extractNumericValue(newContent, task);
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
