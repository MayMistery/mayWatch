import test from 'node:test';
import assert from 'node:assert/strict';

test('the bundled UMD build exposes Chart after a direct module import', async () => {
  const mod = await import('../lib/vendor/chart.umd.min.js');
  const Chart = globalThis.Chart || mod.Chart || mod.default?.Chart || mod.default;

  assert.equal(typeof Chart, 'function');
  assert.equal(Chart.version, '4.4.7');
});
