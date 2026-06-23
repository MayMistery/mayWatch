import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractNumericValue,
  isNumericTask,
  isPlaceholderReading,
  decideCheck,
} from '../background/differ.js';

const numericTask = (over = {}) => ({
  id: 't1',
  numericMode: 'template',
  numericTemplate: 'with-unit',
  ...over,
});

/**
 * Mirrors scheduler.checkSingleTask: feeds readings one by one through
 * decideCheck against an in-memory snapshot, accumulating the numeric
 * history exactly as background/scheduler.js + storage.js would.
 */
function simulate(task, readings) {
  let snapshot = null;
  const history = [];
  const changes = [];
  const actions = [];

  for (const reading of readings) {
    const d = decideCheck(task, snapshot, reading);
    actions.push(d.action);

    if (d.action === 'skip') continue;

    snapshot = { content: d.content };

    if (d.action === 'first_snapshot') {
      if (d.numericPoint != null) history.push(d.numericPoint);
    } else if (d.action === 'change') {
      changes.push(d);
      if (d.numericPoint != null) history.push(d.numericPoint);
    }
  }

  return { history, changes, actions, snapshot };
}

// --- extractNumericValue -----------------------------------------------------

test('extractNumericValue: off mode never extracts', () => {
  assert.deepEqual(
    extractNumericValue('1234ms', { numericMode: 'off' }),
    { isNumeric: false, numericValue: null }
  );
});

test('extractNumericValue: template with-unit', () => {
  const r = extractNumericValue('响应 1234ms', numericTask());
  assert.equal(r.isNumeric, true);
  assert.equal(r.numericValue, 1234);
});

test('extractNumericValue: template currency strips symbol and commas', () => {
  const r = extractNumericValue('总价 ¥1,299.90', numericTask({ numericTemplate: 'currency' }));
  assert.equal(r.isNumeric, true);
  assert.equal(r.numericValue, 1299.9);
});

test('extractNumericValue: regex capture group', () => {
  const r = extractNumericValue('latency=87ms', numericTask({ numericMode: 'regex', numericRegex: '(\\d+)ms' }));
  assert.equal(r.numericValue, 87);
});

test('extractNumericValue: auto detects a bare number', () => {
  const r = extractNumericValue('在线人数 5230 人', numericTask({ numericMode: 'auto' }));
  assert.equal(r.isNumeric, true);
  assert.equal(r.numericValue, 5230);
});

// --- isNumericTask -----------------------------------------------------------

test('isNumericTask: true when a mode is set, false when off/missing', () => {
  assert.equal(isNumericTask({ numericMode: 'auto' }), true);
  assert.equal(isNumericTask({ numericMode: 'off' }), false);
  assert.equal(isNumericTask({}), false);
});

// --- isPlaceholderReading ----------------------------------------------------

test('isPlaceholderReading: catches empty / dashes / loading tokens', () => {
  for (const p of ['', '   ', '—', '--', '···', '…', 'N/A', 'n/a', 'Loading...', '加载中', '暂无数据']) {
    assert.equal(isPlaceholderReading(p), true, `expected placeholder: ${JSON.stringify(p)}`);
  }
});

test('isPlaceholderReading: real values are not placeholders', () => {
  for (const v of ['0', '42', '1234ms', '¥89.9', '在线 5230 人']) {
    assert.equal(isPlaceholderReading(v), false, `expected real value: ${JSON.stringify(v)}`);
  }
});

// --- decideCheck -------------------------------------------------------------

test('decideCheck: first snapshot records a numeric baseline point', () => {
  const d = decideCheck(numericTask(), null, '1234ms');
  assert.equal(d.action, 'first_snapshot');
  assert.equal(d.numericPoint, 1234); // <-- baseline; the missing point that broke trend charts
});

test('decideCheck: numeric-mode placeholder is skipped, snapshot preserved', () => {
  const d = decideCheck(numericTask(), { content: '1234ms' }, '—');
  assert.equal(d.action, 'skip');
  assert.equal(d.reason, 'placeholder');
});

test('decideCheck: numeric-mode reading with a label but no number is skipped', () => {
  // The realistic refresh case: "库存: 240" briefly becomes "库存: —".
  const task = numericTask({ numericMode: 'auto' });
  const d = decideCheck(task, { content: '库存: 240' }, '库存: —');
  assert.equal(d.action, 'skip');
  assert.equal(d.reason, 'no-value');
});

test('decideCheck: numeric-mode first reading without a number is skipped (no bogus baseline)', () => {
  const d = decideCheck(numericTask({ numericMode: 'auto' }), null, '加载中…');
  assert.equal(d.action, 'skip');
});

test('decideCheck: non-numeric task treats a dash as a real change', () => {
  const d = decideCheck({ id: 't', numericMode: 'off' }, { content: 'hello' }, '—');
  assert.notEqual(d.action, 'skip');
});

test('decideCheck: numeric change carries the new point', () => {
  const d = decideCheck(numericTask(), { content: '1234ms' }, '1250ms');
  assert.equal(d.action, 'change');
  assert.equal(d.numericPoint, 1250);
  assert.ok(d.diffResult);
});

test('decideCheck: identical content yields no_change', () => {
  const d = decideCheck(numericTask(), { content: '1234ms' }, '1234ms');
  assert.equal(d.action, 'no_change');
});

// --- end-to-end series behavior (the reported bug) ---------------------------

test('series: a single observed change is enough to render a trend (history >= 2)', () => {
  const { history } = simulate(numericTask(), ['1234ms', '1250ms']);
  assert.deepEqual(history, [1234, 1250]);
  assert.ok(history.length >= 2, 'panel renderTrendChart requires history.length >= 2');
});

test('series: placeholder on refresh does not pollute history or snapshot', () => {
  const { history, changes, snapshot } = simulate(numericTask(), ['1234ms', '—', '1250ms']);
  assert.deepEqual(history, [1234, 1250]);
  assert.equal(changes.length, 1, 'placeholder must not create a spurious diff change');
  assert.equal(snapshot.content, '1250ms', 'snapshot must keep last good value, never the placeholder');
});

test('series: monitored number climbing produces a continuous trend', () => {
  const { history } = simulate(numericTask({ numericMode: 'auto' }), ['10', '12', '12', '15', '21']);
  // unchanged ticks produce no points; the trend still grows monotonically here
  assert.deepEqual(history, [10, 12, 15, 21]);
});
