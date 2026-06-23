import assert from 'node:assert/strict';
import test from 'node:test';

function createChromeMock() {
  const store = new Map();
  const parseQueue = [];
  const messages = [];

  const getValue = (key) => store.has(key) ? store.get(key) : undefined;

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === 'string') {
            const value = getValue(keys);
            return value === undefined ? {} : { [keys]: value };
          }
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map(k => [k, getValue(k)]).filter(([, v]) => v !== undefined));
          }
          if (keys && typeof keys === 'object') {
            return Object.fromEntries(Object.entries(keys).map(([k, fallback]) => [k, getValue(k) ?? fallback]));
          }
          return Object.fromEntries(store.entries());
        },
        async set(values) {
          for (const [key, value] of Object.entries(values)) store.set(key, value);
        },
        async remove(key) {
          store.delete(key);
        },
      },
    },
    runtime: {
      async getContexts() {
        return [{}];
      },
      async sendMessage(message) {
        messages.push(message);
        if (message.type === 'PARSE_HTML') {
          return { content: parseQueue.shift() ?? '' };
        }
        return {};
      },
    },
    tabs: {
      async query() {
        return [];
      },
    },
  };
  globalThis.fetch = async () => ({
    ok: true,
    async text() {
      return '<html><body>metric</body></html>';
    },
  });

  return {
    store,
    messages,
    parseQueue,
    get(key) {
      return store.get(key);
    },
    queueContent(...contents) {
      parseQueue.push(...contents);
    },
  };
}

function numericTask(overrides = {}) {
  return {
    id: 'latency-task',
    name: 'API latency',
    url: 'https://maywatch.test/metrics',
    selector: '#latency',
    selectorType: 'css',
    enabled: true,
    interval: 1,
    lastCheckedAt: 0,
    numericMode: 'template',
    numericTemplate: 'with-unit',
    numericRegex: '',
    ...overrides,
  };
}

test('numeric first snapshot is stored as the first trend point', async () => {
  const chromeMock = createChromeMock();
  chromeMock.queueContent('Latency 120ms');

  const { checkSingleTask } = await import('../background/scheduler.js');

  const result = await checkSingleTask(numericTask());

  assert.equal(result.status, 'first_snapshot');
  assert.deepEqual(chromeMock.get('numericHistory:latency-task').map(p => p.value), [120]);
});

test('numeric placeholder refresh does not replace the last real snapshot or create a diff', async () => {
  const chromeMock = createChromeMock();
  chromeMock.queueContent('Latency 120ms', 'Loading...');

  const { checkSingleTask } = await import('../background/scheduler.js');
  const task = numericTask();

  await checkSingleTask(task);
  const result = await checkSingleTask(task);

  assert.equal(result.status, 'numeric_placeholder');
  assert.equal(chromeMock.get('snapshot:latency-task').content, 'Latency 120ms');
  assert.equal(chromeMock.get('changes'), undefined);
  assert.deepEqual(chromeMock.get('numericHistory:latency-task').map(p => p.value), [120]);
});

test('numeric page records a two point trend after value changes', async () => {
  const chromeMock = createChromeMock();
  chromeMock.queueContent('Latency 120ms', 'Latency 180ms');

  const { checkSingleTask } = await import('../background/scheduler.js');
  const task = numericTask();

  await checkSingleTask(task);
  const result = await checkSingleTask(task);

  assert.equal(result.status, 'changed');
  assert.equal(result.change.isNumeric, true);
  assert.deepEqual(chromeMock.get('numericHistory:latency-task').map(p => p.value), [120, 180]);
});
