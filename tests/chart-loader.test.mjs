import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

function createRoot() {
  const nodes = new Map();
  const noop = () => {};

  const node = (id) => {
    if (!nodes.has(id)) {
      const classes = new Set(id === 'mw-chart-container' ? ['hidden'] : []);
      nodes.set(id, {
        id,
        classList: {
          add: name => classes.add(name),
          remove: name => classes.delete(name),
          toggle: name => classes.has(name) ? classes.delete(name) : classes.add(name),
          contains: name => classes.has(name),
        },
        addEventListener: noop,
        querySelectorAll: () => [],
        querySelector: () => ({ addEventListener: noop, style: {} }),
        getContext: () => ({}),
        textContent: '',
        innerHTML: '',
        style: {},
      });
    }
    return nodes.get(id);
  };

  const root = {
    getElementById: node,
    querySelectorAll: () => [],
    querySelector: () => ({ addEventListener: noop, style: {} }),
  };
  root.nodes = nodes;
  return root;
}

async function importPanel() {
  return import(`../content/panel.js?test=${randomUUID()}`);
}

test('panel chart loader imports the web-accessible Chart UMD URL directly', async () => {
  let chartRenderCount = 0;
  globalThis.window = {
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener() {},
  };
  globalThis.chrome = {
    runtime: {
      getURL: () => 'data:text/javascript,globalThis.Chart%20%3D%20function%20ChartCtor()%20%7B%20globalThis.__chartRenderCount%2B%2B%3B%20%7D%3B',
      onMessage: { addListener() {} },
      async sendMessage(message) {
        if (message.type === 'GET_NUMERIC_HISTORY') {
          return {
            history: [
              { value: 120, timestamp: 1000 },
              { value: 180, timestamp: 2000 },
            ],
          };
        }
        return {};
      },
    },
  };

  globalThis.fetch = async () => {
    throw new Error('direct import should not need fetch');
  };
  globalThis.__chartRenderCount = 0;

  try {
    const { Panel } = await importPanel();
    const root = createRoot();
    const panel = new Panel(root);

    await panel.renderTrendChart('latency-task');

    chartRenderCount = globalThis.__chartRenderCount;
    assert.equal(root.getElementById('mw-chart-container').classList.contains('hidden'), false);
    assert.equal(chartRenderCount, 1);
  } finally {
    delete globalThis.Chart;
    delete globalThis.__chartRenderCount;
    delete globalThis.window;
  }
});

test('panel chart loader falls back to global Chart exposed by UMD bundle for trend rendering', async () => {
  let chartRenderCount = 0;
  globalThis.window = {
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener() {},
  };
  globalThis.chrome = {
    runtime: {
      getURL: path => `chrome-extension://maywatch/${path}`,
      onMessage: { addListener() {} },
      async sendMessage(message) {
        if (message.type === 'GET_NUMERIC_HISTORY') {
          return {
            history: [
              { value: 120, timestamp: 1000 },
              { value: 180, timestamp: 2000 },
            ],
          };
        }
        return {};
      },
    },
  };

  globalThis.fetch = async () => ({
    async text() {
      return 'globalThis.Chart = function ChartCtor() {};';
    },
  });
  const previousCreateObjectURL = URL.createObjectURL;
  const previousRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = () => `data:text/javascript,globalThis.Chart%20%3D%20function%20ChartCtor()%20%7B%20globalThis.__chartRenderCount%2B%2B%3B%20%7D%3B%2F%2F${randomUUID()}`;
  URL.revokeObjectURL = () => {};
  globalThis.__chartRenderCount = 0;

  try {
    const { Panel } = await importPanel();
    const root = createRoot();
    const panel = new Panel(root);

    await panel.renderTrendChart('latency-task');

    chartRenderCount = globalThis.__chartRenderCount;
    assert.equal(root.getElementById('mw-chart-container').classList.contains('hidden'), false);
    assert.equal(chartRenderCount, 1);
  } finally {
    URL.createObjectURL = previousCreateObjectURL;
    URL.revokeObjectURL = previousRevokeObjectURL;
    delete globalThis.Chart;
    delete globalThis.__chartRenderCount;
    delete globalThis.window;
  }
});
