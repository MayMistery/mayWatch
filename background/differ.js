import { diff, computeSummary } from '../lib/diff.js';
import { normalizeText, generateId } from '../utils/common.js';
import { extractNumericValue } from './numeric.js';

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

export function createChangeRecord(task, oldContent, newContent, diffResult, numericResult) {
  const extracted = numericResult || extractNumericValue(newContent, task);
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
    isNumeric: extracted.ok,
    numericValue: extracted.ok ? extracted.value : null,
  };
}
