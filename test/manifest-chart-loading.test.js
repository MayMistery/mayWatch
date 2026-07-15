import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Chart.js loads before the MayWatch content script', async () => {
  const manifestUrl = new URL('../manifest.json', import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const scripts = manifest.content_scripts[0].js;

  assert.deepEqual(scripts.slice(0, 2), [
    'lib/vendor/chart.umd.min.js',
    'content/content-script.js',
  ]);
});
