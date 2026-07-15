import test from 'node:test';
import assert from 'node:assert/strict';

let stored = {};
let pageContent = '10';

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (typeof key === 'string') {
          return key in stored ? { [key]: structuredClone(stored[key]) } : {};
        }
        return structuredClone(stored);
      },
      async set(values) {
        Object.assign(stored, structuredClone(values));
      },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          delete stored[key];
        }
      },
    },
  },
  runtime: {
    async sendMessage() {
      return {};
    },
  },
  tabs: {
    async query(queryInfo) {
      return queryInfo.url ? [{ id: 1, status: 'complete' }] : [];
    },
    async sendMessage() {
      return {};
    },
  },
  scripting: {
    async executeScript() {
      return [{ result: { content: pageContent } }];
    },
  },
};

const { checkSingleTask } = await import('../background/scheduler.js');
const { getChanges, getNumericHistory } = await import('../background/storage.js');

test.beforeEach(() => {
  stored = {};
  pageContent = '10';
});

test('first snapshot and first numeric change produce a renderable history', async () => {
  const task = {
    id: 'task-1',
    name: 'Price',
    url: 'https://example.com/price',
    selector: '#price',
    selectorType: 'css',
    interval: 5,
    enabled: true,
    lastCheckedAt: 0,
    numericMode: 'auto',
    numericTemplate: 'integer',
    numericRegex: '',
  };

  const firstResult = await checkSingleTask(task);
  assert.equal(firstResult.status, 'first_snapshot');
  assert.deepEqual(
    (await getNumericHistory(task.id)).map(point => point.value),
    [10],
  );

  pageContent = '12';
  const changeResult = await checkSingleTask(task);
  assert.equal(changeResult.status, 'changed');
  assert.deepEqual(
    (await getNumericHistory(task.id)).map(point => point.value),
    [10, 12],
  );

  const changes = await getChanges();
  assert.equal(changes.length, 1);
  assert.equal(changes[0].isNumeric, true);
  assert.equal(changes[0].numericValue, 12);
});
