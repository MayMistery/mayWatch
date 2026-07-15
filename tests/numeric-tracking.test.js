import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const storageData = new Map();
let pageContent = '';

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const result = {};
        const requested = Array.isArray(keys) ? keys : [keys];
        for (const key of requested) {
          if (storageData.has(key)) result[key] = clone(storageData.get(key));
        }
        return result;
      },
      async set(values) {
        for (const [key, value] of Object.entries(values)) {
          storageData.set(key, clone(value));
        }
      },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          storageData.delete(key);
        }
      },
    },
  },
  runtime: {
    async getContexts() {
      return [{ contextType: 'OFFSCREEN_DOCUMENT' }];
    },
    async sendMessage(message) {
      if (message.type === 'PARSE_HTML') return { content: pageContent };
      return { success: true };
    },
  },
  offscreen: {
    async createDocument() {},
  },
  tabs: {
    query(_query, callback) {
      if (callback) {
        callback([]);
        return undefined;
      }
      return Promise.resolve([]);
    },
    sendMessage() {
      return Promise.resolve();
    },
  },
  scripting: {
    async executeScript() {
      throw new Error('No matching live tab in tests');
    },
  },
};

globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  async text() {
    return '<html></html>';
  },
});

const {
  addNumericPointIfChanged,
  deleteTask,
  getChanges,
  getNumericHistory,
  getSnapshot,
  hasTaskRuntimeSemanticChange,
  resetTaskRuntimeData,
  saveSnapshot,
  saveTask,
} = await import('../background/storage.js');
const { extractNumericValue } = await import('../background/numeric.js');
const { checkSingleTask } = await import('../background/scheduler.js');

beforeEach(() => {
  storageData.clear();
  pageContent = '';
});

test('extracts values in auto, template, and regex modes', () => {
  assert.deepEqual(
    extractNumericValue('价格 ¥1,234.50', { numericMode: 'auto' }),
    { ok: true, value: 1234.5, reason: null },
  );
  assert.deepEqual(
    extractNumericValue('耗时 11812ms', {
      numericMode: 'template',
      numericTemplate: 'with-unit',
    }),
    { ok: true, value: 11812, reason: null },
  );
  assert.deepEqual(
    extractNumericValue('耗时 42ms', {
      numericMode: 'regex',
      numericRegex: '(\\d+)ms',
    }),
    { ok: true, value: 42, reason: null },
  );
});

test('returns diagnostic reasons for disabled, invalid, and unmatched extraction', () => {
  assert.equal(extractNumericValue('100', { numericMode: 'off' }).reason, 'disabled');
  assert.equal(
    extractNumericValue('100', { numericMode: 'regex', numericRegex: '(' }).reason,
    'invalid_regex',
  );
  assert.equal(
    extractNumericValue('no value', {
      numericMode: 'template',
      numericTemplate: 'integer',
    }).reason,
    'no_match',
  );
});

test('stores the first numeric point and deduplicates equal values', async () => {
  assert.deepEqual(
    await addNumericPointIfChanged('task-1', 100, 1),
    { added: true, historyLength: 1 },
  );
  assert.deepEqual(
    await addNumericPointIfChanged('task-1', 100, 2),
    { added: false, historyLength: 1 },
  );
  assert.deepEqual(
    await addNumericPointIfChanged('task-1', 101, 3),
    { added: true, historyLength: 2 },
  );
  assert.deepEqual(await getNumericHistory('task-1'), [
    { value: 100, timestamp: 1 },
    { value: 101, timestamp: 3 },
  ]);
});

test('keeps only the latest 100 valid numeric points', async () => {
  for (let value = 0; value < 101; value++) {
    await addNumericPointIfChanged('task-1', value, value + 1);
  }
  const history = await getNumericHistory('task-1');
  assert.equal(history.length, 100);
  assert.equal(history[0].value, 1);
  assert.equal(history.at(-1).value, 100);
});

test('filters malformed numeric history entries', async () => {
  storageData.set('numericHistory:task-1', [
    { value: 10, timestamp: 1 },
    { value: Number.NaN, timestamp: 2 },
    { value: 11, timestamp: 'bad' },
    null,
  ]);
  assert.deepEqual(await getNumericHistory('task-1'), [
    { value: 10, timestamp: 1 },
  ]);
});

test('scheduler records a baseline and the first changed value', async () => {
  const task = {
    id: 'task-1',
    name: 'Counter',
    url: 'https://example.com/counter',
    selector: '#counter',
    selectorType: 'css',
    interval: 5,
    enabled: true,
    lastCheckedAt: 0,
    numericMode: 'auto',
    numericTemplate: 'integer',
    numericRegex: '',
  };

  pageContent = '100';
  const first = await checkSingleTask(task);
  assert.equal(first.status, 'first_snapshot');
  assert.deepEqual((await getNumericHistory(task.id)).map(point => point.value), [100]);

  pageContent = '100';
  const unchanged = await checkSingleTask(task);
  assert.equal(unchanged.status, 'no_change');
  assert.deepEqual((await getNumericHistory(task.id)).map(point => point.value), [100]);

  pageContent = '101';
  const changed = await checkSingleTask(task);
  assert.equal(changed.status, 'changed');
  assert.equal(changed.change.isNumeric, true);
  assert.equal(changed.change.numericValue, 101);
  assert.deepEqual((await getNumericHistory(task.id)).map(point => point.value), [100, 101]);
  assert.equal((await getChanges()).length, 1);
});

test('text changes can create a change record without duplicating the numeric value', async () => {
  const task = {
    id: 'task-1',
    name: 'Latency',
    url: 'https://example.com/latency',
    selector: '#latency',
    selectorType: 'css',
    interval: 5,
    enabled: true,
    lastCheckedAt: 0,
    numericMode: 'auto',
  };

  pageContent = 'Latency: 100ms';
  await checkSingleTask(task);
  pageContent = 'Current latency: 100ms';
  const result = await checkSingleTask(task);

  assert.equal(result.status, 'changed');
  assert.equal(result.change.numericValue, 100);
  assert.deepEqual((await getNumericHistory(task.id)).map(point => point.value), [100]);
});

test('scheduler does not write history when numeric tracking is disabled', async () => {
  const task = {
    id: 'task-1',
    name: 'Text only',
    url: 'https://example.com/text',
    selector: null,
    selectorType: 'css',
    interval: 5,
    enabled: true,
    lastCheckedAt: 0,
    numericMode: 'off',
  };

  pageContent = '100';
  await checkSingleTask(task);

  assert.deepEqual(await getNumericHistory(task.id), []);
});

test('deleting a task clears its snapshot and numeric history', async () => {
  await saveTask({ id: 'task-1', name: 'Counter' });
  await saveSnapshot({ taskId: 'task-1', content: '100', timestamp: 1 });
  await addNumericPointIfChanged('task-1', 100, 1);

  await deleteTask('task-1');

  assert.equal(await getSnapshot('task-1'), null);
  assert.deepEqual(await getNumericHistory('task-1'), []);
});

test('resetTaskRuntimeData clears runtime keys without deleting the task', async () => {
  await saveTask({ id: 'task-1', name: 'Counter' });
  await saveSnapshot({ taskId: 'task-1', content: '100', timestamp: 1 });
  await addNumericPointIfChanged('task-1', 100, 1);

  await resetTaskRuntimeData('task-1');

  assert.equal(await getSnapshot('task-1'), null);
  assert.deepEqual(await getNumericHistory('task-1'), []);
  assert.equal(storageData.get('tasks').length, 1);
});

test('detects task edits that change runtime semantics', () => {
  const task = {
    id: 'task-1',
    name: 'Counter',
    url: 'https://example.com',
    selector: '#counter',
    selectorType: 'css',
    interval: 5,
    enabled: true,
    numericMode: 'auto',
    numericTemplate: 'integer',
    numericRegex: '',
  };

  assert.equal(hasTaskRuntimeSemanticChange(task, { ...task, name: 'Renamed' }), false);
  assert.equal(hasTaskRuntimeSemanticChange(task, { ...task, interval: 60 }), false);
  assert.equal(hasTaskRuntimeSemanticChange(task, { ...task, selector: '#next' }), true);
  assert.equal(hasTaskRuntimeSemanticChange(task, { ...task, numericMode: 'off' }), true);
});

test('bundled Chart.js UMD exposes a global constructor when imported as a module', async () => {
  delete globalThis.Chart;
  await import('../lib/vendor/chart.umd.min.js');
  assert.equal(typeof globalThis.Chart, 'function');
});

test('panel loads Chart.js from the extension URL without a blob module', async () => {
  const source = await readFile(new URL('../content/panel.js', import.meta.url), 'utf8');
  assert.match(source, /chrome\.runtime\.getURL\('lib\/vendor\/chart\.umd\.min\.js'\)/);
  assert.match(source, /globalThis\.Chart/);
  assert.doesNotMatch(source, /createObjectURL|new Blob/);
});
