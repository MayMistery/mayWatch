import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const fixtureDir = new URL('./fixtures/', import.meta.url);

const expectedFixtures = [
  {
    file: 'react-monitoring.html',
    selectors: ['#react-latency', '#react-error-rate', '#react-placeholder-toggle'],
  },
  {
    file: 'vue-monitoring.html',
    selectors: ['#vue-revenue', '#vue-conversion-rate', '#vue-placeholder-toggle'],
  },
  {
    file: 'alpine-monitoring.html',
    selectors: ['#alpine-queue-depth', '#alpine-worker-lag', '#alpine-placeholder-toggle'],
  },
  {
    file: 'vanilla-monitoring.html',
    selectors: ['#vanilla-cpu', '#vanilla-memory', '#vanilla-placeholder-toggle'],
  },
];

test('monitoring fixture pages cover numeric values and placeholder refresh states', async () => {
  for (const fixture of expectedFixtures) {
    const html = await readFile(join(fixtureDir.pathname, fixture.file), 'utf8');
    assert.match(html, /Loading\.\.\.|加载中|--/);
    for (const selector of fixture.selectors) {
      const id = selector.slice(1);
      assert.ok(
        html.includes(`id="${id}"`) || html.includes(`id: '${id}'`) || html.includes(`id: "${id}"`),
        `${fixture.file} missing ${selector}`,
      );
    }
  }
});
