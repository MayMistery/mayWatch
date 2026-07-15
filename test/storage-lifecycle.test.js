import test from 'node:test';
import assert from 'node:assert/strict';

let stored = {};

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
};

const {
  addNumericPoint,
  deleteTask,
  getNumericHistory,
  saveTask,
} = await import('../background/storage.js');

test.beforeEach(() => {
  stored = {};
});

test('a baseline and the first changed value produce two trend points', async () => {
  await addNumericPoint('task-1', 10, 1);
  await addNumericPoint('task-1', 12, 2);

  assert.deepEqual(await getNumericHistory('task-1'), [
    { value: 10, timestamp: 1 },
    { value: 12, timestamp: 2 },
  ]);
});

test('changing numeric configuration resets the snapshot and numeric history', async () => {
  stored = {
    tasks: [{
      id: 'task-1',
      url: 'https://example.com',
      selector: '#price',
      selectorType: 'css',
      numericMode: 'auto',
      numericTemplate: 'integer',
      numericRegex: '',
    }],
    'snapshot:task-1': { taskId: 'task-1', content: '10' },
    'numericHistory:task-1': [{ value: 10, timestamp: 1 }],
  };

  await saveTask({
    ...stored.tasks[0],
    numericMode: 'regex',
    numericRegex: '(\\d+)',
  });

  assert.equal(stored['snapshot:task-1'], undefined);
  assert.equal(stored['numericHistory:task-1'], undefined);
});

test('updating scheduler metadata preserves numeric history', async () => {
  stored = {
    tasks: [{
      id: 'task-1',
      url: 'https://example.com',
      selector: '#price',
      selectorType: 'css',
      numericMode: 'auto',
      numericTemplate: 'integer',
      numericRegex: '',
      lastCheckedAt: 1,
    }],
    'snapshot:task-1': { taskId: 'task-1', content: '10' },
    'numericHistory:task-1': [{ value: 10, timestamp: 1 }],
  };

  await saveTask({ ...stored.tasks[0], lastCheckedAt: 2 });

  assert.equal(stored['snapshot:task-1'].content, '10');
  assert.equal(stored['numericHistory:task-1'].length, 1);
});

test('deleting a task also deletes its snapshot and numeric history', async () => {
  stored = {
    tasks: [{ id: 'task-1' }],
    'snapshot:task-1': { taskId: 'task-1', content: '10' },
    'numericHistory:task-1': [{ value: 10, timestamp: 1 }],
  };

  await deleteTask('task-1');

  assert.deepEqual(stored.tasks, []);
  assert.equal(stored['snapshot:task-1'], undefined);
  assert.equal(stored['numericHistory:task-1'], undefined);
});
