import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';
import { join } from 'path';

const SCREENSHOT_DIR = join(process.cwd(), 'test-screenshots');
const EXTENSION_PATH = process.cwd();
const TEST_URL = 'http://127.0.0.1:8730/maywatch-test.html';

mkdirSync(SCREENSHOT_DIR, { recursive: true });

let shotIndex = 0;
async function screenshot(page, name) {
  shotIndex++;
  const filename = `${String(shotIndex).padStart(2, '0')}-${name}.png`;
  const filepath = join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  console.log(`  [SCREENSHOT] ${filename}`);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('=== MayWatch E2E Test ===\n');

  console.log('Launching Chrome with MayWatch extension...');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
    ignoreDefaultArgs: ['--disable-extensions'],
  });
  console.log('Chrome launched.\n');
  await sleep(3000);

  const targets = await browser.targets();
  const swTarget = targets.find(t => t.url().includes('chrome-extension://') && t.url().includes('service-worker'));
  if (!swTarget) {
    console.log('ERROR: MayWatch extension not loaded!');
    await browser.close();
    process.exit(1);
  }
  const extId = new URL(swTarget.url()).hostname;
  console.log(`Extension ID: ${extId}\n`);

  const swSession = await swTarget.createCDPSession();
  await swSession.send('Runtime.enable');

  async function swEval(expression) {
    const result = await swSession.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      const err = result.exceptionDetails;
      throw new Error(`SW eval error: ${err.text || err.exception?.description || JSON.stringify(err)}`);
    }
    return result.result?.value;
  }

  // Clear all storage first
  console.log('Clearing storage...');
  await swEval(`chrome.storage.local.clear()`);
  await sleep(500);

  // Step 1: Navigate to test page
  console.log('Step 1: Opening test page...');
  const testPage = await browser.newPage();

  // Listen for console messages from the page
  testPage.on('console', msg => {
    if (msg.text().includes('[MayWatch]') || msg.text().includes('Chart')) {
      console.log('  [CONSOLE]', msg.type(), msg.text());
    }
  });

  await testPage.goto(TEST_URL, { waitUntil: 'networkidle0', timeout: 15000 });
  await sleep(2000);
  await screenshot(testPage, '01-test-page-loaded');
  console.log('  Test page loaded.\n');

  // Step 2: Create monitoring task
  console.log('Step 2: Creating monitoring task...');
  const taskId = crypto.randomUUID();
  const task = {
    id: taskId,
    url: TEST_URL,
    name: 'heroRevenue监控',
    selector: '#heroRevenue',
    selectorType: 'css',
    interval: 99999,
    enabled: true,
    createdAt: Date.now(),
    lastCheckedAt: Date.now(),
    numericMode: 'auto',
    numericTemplate: 'with-unit',
    numericRegex: '',
  };

  await swEval(`
    (async () => {
      const task = ${JSON.stringify(task)};
      await chrome.storage.local.set({ tasks: [task] });
      return 'ok';
    })()
  `);
  console.log(`  Task created: ${taskId}\n`);

  // Step 2b: Establish baseline snapshot
  console.log('Step 2b: Establishing baseline snapshot...');
  const baselineResult = await swEval(`self.__maywatch_test__.checkAllTasks()`);
  console.log(`  Baseline: ${JSON.stringify(baselineResult)}`);
  await sleep(1000);

  // Debug: check tabs and content
  const debugInfo = await swEval(`
    (async () => {
      const tabs = await chrome.tabs.query({});
      const tabList = tabs.map(t => ({ id: t.id, url: t.url, status: t.status }));
      const content = await self.__maywatch_test__.fetchPageContent('${TEST_URL}', '#heroRevenue', 'css');
      const key = 'snapshot:${taskId}';
      const snapData = await chrome.storage.local.get(key);
      return { tabs: tabList, content, snapshot: snapData[key]?.content };
    })()
  `);
  console.log(`  Debug tabs: ${JSON.stringify(debugInfo.tabs)}`);
  console.log(`  Debug: content="${debugInfo.content}", snapshot="${debugInfo.snapshot}"\n`);

  // Step 3: Trigger value changes
  console.log('Step 3: Triggering value changes...');

  async function clickAndCheck(buttonText, stepNum) {
    await testPage.bringToFront();

    // Use direct function calls instead of button clicks to ensure DOM changes
    if (buttonText === '+50,000') {
      await testPage.evaluate(() => { changeRevenue(50000); });
    } else if (buttonText === '随机') {
      await testPage.evaluate(() => { randomRevenue(); });
    } else if (buttonText === '-30,000') {
      await testPage.evaluate(() => { changeRevenue(-30000); });
    }
    await sleep(2000);

    // Verify DOM value directly from test page
    const domValue = await testPage.evaluate(() => {
      return document.querySelector('#heroRevenue').textContent;
    });
    console.log(`    [${stepNum}] DOM value: "${domValue}"`);

    const result = await swEval(`self.__maywatch_test__.checkAllTasks()`);
    console.log(`    [${stepNum}] CHECK_NOW result: ${JSON.stringify(result)}`);
    await sleep(3000);
    console.log(`  Clicked "${buttonText}", checked.`);
  }

  await clickAndCheck('+50,000', 1);
  await clickAndCheck('随机', 2);
  await clickAndCheck('+50,000', 3);
  await clickAndCheck('随机', 4);

  await testPage.bringToFront();
  await screenshot(testPage, '06-after-value-changes');
  console.log('  Value changes done.\n');

  // Step 4: Trigger refresh placeholder
  console.log('Step 4: Triggering refresh placeholder...');
  await testPage.bringToFront();
  await testPage.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      if (btn.textContent.includes('模拟刷新')) btn.click();
    }
  });
  console.log('  Clicked 模拟刷新（占位值）...');

  await sleep(1500);
  const placeholderResult = await swEval(`self.__maywatch_test__.checkAllTasks()`);
  console.log(`    CHECK_NOW during placeholder: ${JSON.stringify(placeholderResult)}`);
  await sleep(3000);

  await sleep(3000);
  const afterResult = await swEval(`self.__maywatch_test__.checkAllTasks()`);
  console.log(`    CHECK_NOW after placeholder: ${JSON.stringify(afterResult)}`);
  await sleep(3000);

  await testPage.bringToFront();
  await screenshot(testPage, '07-after-refresh-placeholder');
  console.log('  Refresh placeholder done.\n');

  // Step 5: Open MayWatch detail panel
  console.log('Step 5: Opening MayWatch detail panel...');

  await testPage.bringToFront();
  await testPage.evaluate(() => {
    const host = document.querySelector('#maywatch-root');
    if (host && host.shadowRoot) {
      const trigger = host.shadowRoot.querySelector('#mw-trigger');
      if (trigger) trigger.click();
    }
  });
  await sleep(1500);
  await screenshot(testPage, '08-panel-opened');

  await testPage.evaluate(() => {
    const host = document.querySelector('#maywatch-root');
    if (host && host.shadowRoot) {
      const headers = host.shadowRoot.querySelectorAll('.mw-task-group-header');
      for (const h of headers) {
        if (h.textContent.includes('heroRevenue')) {
          h.click();
          break;
        }
      }
    }
  });
  await sleep(500);
  await screenshot(testPage, '09-task-group-expanded');

  await testPage.evaluate(() => {
    const host = document.querySelector('#maywatch-root');
    if (host && host.shadowRoot) {
      const cards = host.shadowRoot.querySelectorAll('.mw-change-card');
      if (cards.length > 0) cards[0].click();
    }
  });
  await sleep(3000);
  await screenshot(testPage, '10-detail-view');
  console.log('  Detail panel opened.\n');

  // Debug shadow DOM state
  const shadowDebug = await testPage.evaluate(() => {
    const host = document.querySelector('#maywatch-root');
    if (!host) return { error: 'no host' };
    const sr = host.shadowRoot;
    if (!sr) return { error: 'no shadowRoot' };
    const detailView = sr.querySelector('#mw-detail-view');
    const chartContainer = sr.querySelector('#mw-chart-container');
    const canvas = sr.querySelector('#mw-trend-chart');
    const chartPlaceholder = sr.querySelector('.mw-chart-placeholder');
    return {
      hasShadowRoot: true,
      detailViewDisplay: detailView ? detailView.style.display : 'not found',
      chartContainerHidden: chartContainer ? chartContainer.classList.contains('hidden') : 'not found',
      chartContainerHTML: chartContainer ? chartContainer.innerHTML.substring(0, 200) : 'not found',
      canvasExists: !!canvas,
      placeholderText: chartPlaceholder ? chartPlaceholder.textContent.substring(0, 100) : 'none',
    };
  });
  console.log('  Shadow DOM debug:', JSON.stringify(shadowDebug, null, 2));

  // Try to manually load Chart.js and check
  const chartDebug = await testPage.evaluate(async () => {
    const host = document.querySelector('#maywatch-root');
    if (!host || !host.shadowRoot) return { error: 'no shadowRoot' };
    const sr = host.shadowRoot;
    // Check if Chart is accessible in the content script's world
    try {
      // We can't access the content script's scope directly from page.evaluate
      // But we can check console messages
      return { note: 'cannot access content script scope from page world' };
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log('  Chart debug:', JSON.stringify(chartDebug));

  // Check if detail view has canvas
  let hasCanvas = false;
  for (let i = 0; i < 5; i++) {
    hasCanvas = await testPage.evaluate(() => {
      const host = document.querySelector('#maywatch-root');
      if (host && host.shadowRoot) {
        const container = host.shadowRoot.querySelector('#mw-chart-container');
        const canvas = host.shadowRoot.querySelector('#mw-trend-chart');
        if (container && !container.classList.contains('hidden') && canvas) {
          return true;
        }
      }
      return false;
    });
    if (hasCanvas) break;
    await sleep(1000);
  }

  // Step 6: Verify numericHistory
  console.log('Step 6: Verifying numericHistory...');

  const storageData = await swEval(`
    (async () => {
      const data = await chrome.storage.local.get(null);
      const result = {};
      for (const [k, v] of Object.entries(data)) {
        if (k.startsWith('numericHistory:')) {
          result[k] = v;
        }
      }
      return result;
    })()
  `);

  console.log('  Storage data:');
  console.log(JSON.stringify(storageData, null, 2));

  const historyKeys = Object.keys(storageData);
  const hasNumericHistory = historyKeys.length > 0;
  let numericHistoryCount = 0;
  let hasPlaceholder = false;

  for (const key of historyKeys) {
    const history = storageData[key];
    numericHistoryCount = history.length;
    console.log(`  ${key}: ${history.length} entries`);
    for (const entry of history) {
      console.log(`    value=${entry.value}, timestamp=${new Date(entry.timestamp).toISOString()}`);
      if (String(entry.value) === '--' || String(entry.value) === 'N/A' || String(entry.value) === 'Loading...' || String(entry.value) === '—') {
        hasPlaceholder = true;
      }
    }
  }

  console.log('\n=== VERIFICATION RESULTS ===');
  console.log(`  numericHistory exists: ${hasNumericHistory ? 'PASS' : 'FAIL'}`);
  console.log(`  numericHistory count >= 2: ${numericHistoryCount >= 2 ? 'PASS' : 'FAIL'} (${numericHistoryCount})`);
  console.log(`  No placeholder in history: ${!hasPlaceholder ? 'PASS' : 'FAIL'}`);
  console.log(`  Detail view has trend canvas: ${hasCanvas ? 'PASS' : 'FAIL'}`);

  await screenshot(testPage, '11-final-state');

  await browser.close();
  console.log('\n=== Test Complete ===');

  const allPassed = hasNumericHistory && numericHistoryCount >= 2 && !hasPlaceholder && hasCanvas;
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
