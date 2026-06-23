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
  'with-unit': /(-?[\d,]+\.?\d*)\s*[a-zA-Z%°]*/,
  currency: /[¥$€£₹]\s*([\d,]+\.?\d*)/,
};

const PLACEHOLDER_PATTERNS = [
  /^\.\.\.$/,
  /^…+$/,
  /^-{2,}$/,
  /^—+$/,
  /^–+$/,
  /^·{2,}$/,
  /^[・•]{2,}$/,
  /^N\/?A$/i,
  /^null$/i,
  /^undefined$/i,
  /^none$/i,
  /^--$/,
  /^-$/,
  /^loading\.{0,3}$/i,
  /^加载中\.{0,3}$/,
  /^载入中\.{0,3}$/,
  /^请稍候\.{0,3}$/,
  /^稍等\.{0,3}$/,
  /^[─━]{2,}$/,
  /^█+$/,
  /^[□■▇▆▅▄▃▂▁]{2,}$/,
];

export function isPlaceholderContent(text) {
  if (!text) return true;
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length > 30) return false;
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  if (/^[\s\p{P}\p{S}]+$/u.test(trimmed) && !/-?\d/.test(trimmed)) {
    return true;
  }
  return false;
}

export function extractNumericValue(text, task = {}) {
  const mode = task.numericMode || 'off';

  if (mode === 'off') {
    return { isNumeric: false, numericValue: null };
  }

  if (!text || isPlaceholderContent(text)) {
    return { isNumeric: false, numericValue: null, wasPlaceholder: true };
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
