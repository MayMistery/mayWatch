import test from 'node:test';
import assert from 'node:assert/strict';

import { extractNumericValue } from '../background/differ.js';

test('extracts numeric values in auto mode', () => {
  assert.deepEqual(
    extractNumericValue('Latency: 11812ms', { numericMode: 'auto' }),
    { isNumeric: true, numericValue: 11812 },
  );
});

test('extracts values with template and regex modes', () => {
  assert.deepEqual(
    extractNumericValue('Price: ¥89.9', {
      numericMode: 'template',
      numericTemplate: 'currency',
    }),
    { isNumeric: true, numericValue: 89.9 },
  );

  assert.deepEqual(
    extractNumericValue('Latency: 42ms', {
      numericMode: 'regex',
      numericRegex: '(\\d+)ms',
    }),
    { isNumeric: true, numericValue: 42 },
  );
});

test('returns a non-numeric result when tracking is disabled or input does not match', () => {
  assert.deepEqual(
    extractNumericValue('42', { numericMode: 'off' }),
    { isNumeric: false, numericValue: null },
  );
  assert.deepEqual(
    extractNumericValue('no value', { numericMode: 'auto' }),
    { isNumeric: false, numericValue: null },
  );
});
