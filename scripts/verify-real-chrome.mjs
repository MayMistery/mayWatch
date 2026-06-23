import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEST_URL = 'http://127.0.0.1:8730/maywatch-test.html';
const TASK_ID = 'real-hero-revenue';
const SCREENSHOT_PATH = process.env.MAYWATCH_SCREENSHOT
  || path.join(os.tmpdir(), 'maywatch-detail.png');

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
};

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();

    ws.addEventListener('message', event => this.onMessage(event));
    ws.addEventListener('error', event => {
      for (const { reject } of this.pending.values()) {
        reject(event.error || new Error('CDP WebSocket error'));
      }
      this.pending.clear();
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    return new Cdp(ws);
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set());
    this.handlers.get(method).add(handler);
  }

  async send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const message = sessionId ? { id, method, params, sessionId } : { id, method, params };

    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.ws.send(JSON.stringify(message));
    return promise;
  }

  async close() {
    this.ws.close();
  }

  onMessage(event) {
    const message = JSON.parse(event.data);
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`${message.error.message}: ${message.error.data || ''}`));
      } else {
        pending.resolve(message.result || {});
      }
      return;
    }

    const handlers = this.handlers.get(message.method);
    if (!handlers) return;
    for (const handler of handlers) handler(message);
  }
}

async function main() {
  assert.ok(existsSync(path.join(PROJECT_ROOT, 'manifest.json')), 'manifest.json exists');
  assert.ok(existsSync(path.join(PROJECT_ROOT, 'maywatch-test.html')), 'maywatch-test.html exists');

  const server = await ensureTestServer();
  const debugPort = await getFreePort();
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'maywatch-chrome-profile-'));
  const chrome = launchChrome(debugPort, userDataDir);
  const chromeLogs = [];
  chrome.stderr.setEncoding('utf8');
  chrome.stderr.on('data', chunk => {
    chromeLogs.push(chunk);
    while (chromeLogs.join('').length > 8000) chromeLogs.shift();
  });
  let cdp;

  try {
    const browserWsUrl = await waitForBrowserWs(debugPort);
    cdp = await Cdp.connect(browserWsUrl);
    const extensionId = await loadUnpackedExtension(cdp, chromeLogs);

    const pageTargetId = await waitForTarget(cdp, target => target.type === 'page' && target.url === TEST_URL);
    const { sessionId: pageSession } = await cdp.send('Target.attachToTarget', {
      targetId: pageTargetId,
      flatten: true,
    });
    const pageLogs = [];
    cdp.on('Runtime.consoleAPICalled', message => {
      if (message.sessionId !== pageSession) return;
      const args = message.params?.args || [];
      pageLogs.push(args.map(arg => arg.value ?? arg.description ?? '').join(' '));
      while (pageLogs.length > 30) pageLogs.shift();
    });

    await cdp.send('Runtime.enable', {}, pageSession);
    await cdp.send('Page.enable', {}, pageSession);
    await cdp.send('DOM.enable', {}, pageSession);
    await cdp.send('Page.reload', { ignoreCache: true }, pageSession);
    await waitForEval(cdp, pageSession, 'document.readyState === "complete" && Boolean(document.querySelector("#heroRevenue"))');
    try {
      await waitForEval(cdp, pageSession, 'Boolean(document.querySelector("#maywatch-root"))');
    } catch (err) {
      const { targetInfos } = await cdp.send('Target.getTargets');
      const pageProbe = await evalValue(cdp, pageSession, `({
        url: location.href,
        readyState: document.readyState,
        hasHeroRevenue: Boolean(document.querySelector('#heroRevenue')),
        hasMaywatchRoot: Boolean(document.querySelector('#maywatch-root')),
        title: document.title
      })`);
      throw new Error(`${err.message}; extensionId=${extensionId}; page=${JSON.stringify(pageProbe)}; targets=${JSON.stringify(targetInfos.map(t => ({ type: t.type, url: t.url })))}; chromeLogs=${chromeLogs.join('').slice(-4000)}`);
    }

    const popupTarget = await cdp.send('Target.createTarget', {
      url: `chrome-extension://${extensionId}/popup/popup.html`,
    });
    const { sessionId: popupSession } = await cdp.send('Target.attachToTarget', {
      targetId: popupTarget.targetId,
      flatten: true,
    });
    await cdp.send('Runtime.enable', {}, popupSession);
    await waitForEval(cdp, popupSession, 'document.readyState !== "loading" && Boolean(chrome?.runtime)');

    const task = {
      id: TASK_ID,
      name: 'Hero Revenue',
      url: TEST_URL,
      selector: '#heroRevenue',
      selectorType: 'css',
      interval: 1,
      enabled: true,
      createdAt: Date.now(),
      lastCheckedAt: 0,
      numericMode: 'auto',
      numericTemplate: 'currency',
      numericRegex: '',
    };

    await evalValue(cdp, popupSession, `
      (async () => {
        await chrome.storage.local.clear();
        await chrome.runtime.sendMessage({
          type: 'SAVE_SETTINGS',
          settings: { globalEnabled: true, maxChanges: 100 }
        });
        await chrome.runtime.sendMessage({
          type: 'SAVE_TASK',
          task: ${JSON.stringify(task)}
        });
        return true;
      })()
    `);

    const checkResults = [];
    await evalValue(cdp, pageSession, preparePageExpression());
    checkResults.push(await checkNow(cdp, popupSession));

    await delay(250);
    await evalValue(cdp, pageSession, advanceSampleExpression());
    checkResults.push(await checkNow(cdp, popupSession));

    await delay(250);
    await evalValue(cdp, pageSession, placeholderExpression());
    const placeholderResult = await checkNow(cdp, popupSession);

    await delay(1600);
    await evalValue(cdp, pageSession, ensureLiveSampleExpression());
    checkResults.push(await checkNow(cdp, popupSession));

    const storageState = await evalValue(cdp, popupSession, `
      (async () => {
        const all = await chrome.storage.local.get(null);
        return {
          history: all['numericHistory:${TASK_ID}'] || [],
          snapshot: all['snapshot:${TASK_ID}'] || null,
          changes: all.changes || [],
        };
      })()
    `);

    assert.equal(placeholderResult.results[0].status, 'numeric_placeholder');
    assert.ok(storageState.history.length >= 2, `numericHistory length ${storageState.history.length} >= 2`);
    assert.ok(storageState.history.every(point => Number.isFinite(point.value)), 'numericHistory contains only numeric points');
    assert.ok(!JSON.stringify(storageState.history).includes('Loading'), 'placeholder text is not stored in numericHistory');
    assert.ok(!storageState.snapshot?.content?.includes('Loading'), 'placeholder does not replace the stored snapshot');
    assert.ok(!storageState.changes.some(change => JSON.stringify(change).includes('Loading')), 'placeholder does not create a change record');
    assert.ok(storageState.changes.length > 0, 'numeric changes exist for opening the detail page');

    await clickNode(cdp, pageSession, node => attr(node, 'id') === 'mw-trigger');
    await waitForNode(cdp, pageSession, node => hasClass(node, 'mw-task-group-header'));
    await clickNode(cdp, pageSession, node => hasClass(node, 'mw-task-group-header'));
    await waitForNode(cdp, pageSession, node => hasClass(node, 'mw-change-card'));
    await clickNode(cdp, pageSession, node => hasClass(node, 'mw-change-card'));

    let chartEvidence;
    try {
      chartEvidence = await waitForCanvasEvidence(cdp, pageSession);
    } catch (err) {
      const canvasEvidence = await readCanvasEvidence(cdp, pageSession).catch(canvasErr => ({ error: canvasErr.message }));
      throw new Error(`${err.message}; canvas=${JSON.stringify(canvasEvidence)}; pageLogs=${JSON.stringify(pageLogs)}`);
    }
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' }, pageSession);
    writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));

    const summary = {
      extensionId,
      taskId: TASK_ID,
      checkStatuses: checkResults.map(result => result.results[0].status),
      placeholderStatus: placeholderResult.results[0].status,
      numericHistoryLength: storageState.history.length,
      numericHistoryValues: storageState.history.map(point => point.value),
      placeholderPersisted: false,
      chartCanvas: chartEvidence,
      screenshotPath: SCREENSHOT_PATH,
    };

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (cdp) {
      await cdp.send('Browser.close').catch(() => {});
      await cdp.close().catch(() => {});
    }
    await stopChrome(chrome);
    server.close();
    await removeDirWithRetry(userDataDir);
  }
}

function launchChrome(debugPort, userDataDir) {
  const chromeBin = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  assert.ok(existsSync(chromeBin), `Chrome binary not found: ${chromeBin}`);

  return spawn(chromeBin, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--enable-logging=stderr',
    '--window-size=1280,900',
    TEST_URL,
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

async function loadUnpackedExtension(cdp, chromeLogs) {
  try {
    const result = await cdp.send('Extensions.loadUnpacked', { path: PROJECT_ROOT });
    assert.ok(result.id, 'Extensions.loadUnpacked returned an extension id');
    return result.id;
  } catch (err) {
    const { targetInfos } = await cdp.send('Target.getTargets').catch(() => ({ targetInfos: [] }));
    throw new Error(`${err.message}; extensionPath=${PROJECT_ROOT}; targets=${JSON.stringify(targetInfos.map(t => ({ type: t.type, url: t.url })))}; chromeLogs=${chromeLogs.join('').slice(-4000)}`);
  }
}

async function stopChrome(chrome) {
  if (chrome.exitCode !== null || chrome.signalCode !== null) return;

  const exited = new Promise(resolve => {
    chrome.once('exit', resolve);
  });

  chrome.kill('SIGTERM');
  await Promise.race([exited, delay(3000)]);

  if (chrome.exitCode === null && chrome.signalCode === null) {
    chrome.kill('SIGKILL');
    await Promise.race([exited, delay(1000)]);
  }
}

async function removeDirWithRetry(dir) {
  let lastError;
  for (let i = 0; i < 8; i++) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch (err) {
      lastError = err;
      await delay(250);
    }
  }
  console.warn(`[MayWatch verify] Could not remove temp profile ${dir}: ${lastError?.message || lastError}`);
}

async function ensureTestServer() {
  if (await hasExistingTestPage()) {
    return { close() {} };
  }
  return startStaticServer();
}

async function hasExistingTestPage() {
  try {
    const response = await fetch(TEST_URL);
    if (!response.ok) return false;
    const html = await response.text();
    return html.includes('id="heroRevenue"') && html.includes('Refresh placeholders');
  } catch {
    return false;
  }
}

async function startStaticServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', TEST_URL);
      const requestPath = url.pathname === '/' ? '/maywatch-test.html' : url.pathname;
      const filePath = path.resolve(PROJECT_ROOT, `.${decodeURIComponent(requestPath)}`);
      if (!filePath.startsWith(PROJECT_ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      const body = await readFile(filePath);
      res.writeHead(200, {
        'content-type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(8730, '127.0.0.1', resolve);
  });
  return server;
}

function preparePageExpression() {
  return `
    (() => {
      const pause = document.getElementById('toggleStream');
      if (pause && /pause/i.test(pause.textContent)) pause.click();
      if (typeof reset === 'function') {
        reset();
      } else if (window.maywatchTest?.reset) {
        window.maywatchTest.reset();
      }
      return document.querySelector('#heroRevenue')?.innerText || document.querySelector('#heroRevenue')?.textContent || '';
    })()
  `;
}

function advanceSampleExpression() {
  return `
    (() => {
      if (typeof step === 'function') {
        step();
      } else if (window.maywatchTest?.nextRevenue) {
        window.maywatchTest.nextRevenue();
      } else if (window.maywatchTest?.setRevenue) {
        window.maywatchTest.setRevenue(125);
      }
      return document.querySelector('#heroRevenue')?.innerText || document.querySelector('#heroRevenue')?.textContent || '';
    })()
  `;
}

function placeholderExpression() {
  return `
    (() => {
      if (typeof setPlaceholders === 'function') {
        setPlaceholders();
      } else if (window.maywatchTest?.showPlaceholder) {
        window.maywatchTest.showPlaceholder();
      } else {
        const target = document.querySelector('#heroRevenue');
        if (target) target.textContent = 'Loading...';
      }
      return document.querySelector('#heroRevenue')?.innerText || document.querySelector('#heroRevenue')?.textContent || '';
    })()
  `;
}

function ensureLiveSampleExpression() {
  return `
    (() => {
      const target = document.querySelector('#heroRevenue');
      const text = target?.innerText || target?.textContent || '';
      if (/loading|暂无数据|^--$|placeholder/i.test(text.trim())) {
        if (typeof step === 'function') {
          step();
        } else if (window.maywatchTest?.setRevenue) {
          window.maywatchTest.setRevenue(130);
        }
      }
      return document.querySelector('#heroRevenue')?.innerText || document.querySelector('#heroRevenue')?.textContent || '';
    })()
  `;
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForBrowserWs(debugPort) {
  return waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (!response.ok) return null;
      const data = await response.json();
      return data.webSocketDebuggerUrl || null;
    } catch {
      return null;
    }
  }, 'Chrome DevTools endpoint');
}

async function waitForTarget(cdp, predicate) {
  return waitFor(async () => {
    const { targetInfos } = await cdp.send('Target.getTargets');
    return targetInfos.find(predicate)?.targetId || null;
  }, 'target');
}

async function checkNow(cdp, popupSession) {
  return evalValue(cdp, popupSession, `
    chrome.runtime.sendMessage({
      type: 'CHECK_NOW',
      taskId: '${TASK_ID}'
    })
  `);
}

async function evalValue(cdp, sessionId, expression) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return response.result.value;
}

async function waitForEval(cdp, sessionId, expression) {
  return waitFor(() => evalValue(cdp, sessionId, expression), expression);
}

async function clickNode(cdp, sessionId, predicate) {
  const node = await waitForNode(cdp, sessionId, predicate);
  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: node.backendNodeId }, sessionId);
  await cdp.send('Runtime.callFunctionOn', {
    objectId: object.objectId,
    functionDeclaration: 'function() { this.click(); return true; }',
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  }, sessionId);
}

async function waitForNode(cdp, sessionId, predicate) {
  return waitFor(async () => {
    const { nodes } = await cdp.send('DOM.getFlattenedDocument', {
      depth: -1,
      pierce: true,
    }, sessionId);
    return nodes.find(predicate) || null;
  }, 'DOM node');
}

async function waitForCanvasEvidence(cdp, sessionId) {
  return waitFor(async () => {
    const evidence = await readCanvasEvidence(cdp, sessionId);
    return evidence.nonEmptyPixels > 50 ? evidence : null;
  }, 'non-empty trend canvas');
}

async function readCanvasEvidence(cdp, sessionId) {
  const container = await findNode(cdp, sessionId, node => attr(node, 'id') === 'mw-chart-container');
  const canvas = await findNode(cdp, sessionId, node => attr(node, 'id') === 'mw-trend-chart');
  if (!canvas) return { hasCanvas: false, containerClass: container ? attr(container, 'class') : null };

  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: canvas.backendNodeId }, sessionId);
  const response = await cdp.send('Runtime.callFunctionOn', {
    objectId: object.objectId,
    functionDeclaration: `
      function() {
        const rect = this.getBoundingClientRect();
        const ctx = this.getContext('2d');
        let nonEmptyPixels = 0;
        if (ctx && this.width && this.height && rect.width !== 0 && rect.height !== 0) {
          const data = ctx.getImageData(0, 0, this.width, this.height).data;
          for (let i = 3; i < data.length; i += 4) {
            if (data[i] !== 0) nonEmptyPixels++;
            if (nonEmptyPixels > 50) break;
          }
        }
        return {
          hasCanvas: true,
          width: this.width,
          height: this.height,
          cssWidth: rect.width,
          cssHeight: rect.height,
          nonEmptyPixels,
          containerClass: this.parentElement?.className || null,
          detailTitle: this.getRootNode().getElementById('mw-detail-title')?.textContent || null,
          listDisplay: this.getRootNode().getElementById('mw-list-view')?.style.display || null,
          detailDisplay: this.getRootNode().getElementById('mw-detail-view')?.style.display || null
        };
      }
    `,
    returnByValue: true,
  }, sessionId);

  return response.result.value;
}

async function findNode(cdp, sessionId, predicate) {
  const { nodes } = await cdp.send('DOM.getFlattenedDocument', {
    depth: -1,
    pierce: true,
  }, sessionId);
  return nodes.find(predicate) || null;
}

function attr(node, name) {
  const attributes = node.attributes || [];
  for (let i = 0; i < attributes.length; i += 2) {
    if (attributes[i] === name) return attributes[i + 1];
  }
  return null;
}

function hasClass(node, className) {
  return (attr(node, 'class') || '').split(/\s+/).includes(className);
}

async function waitFor(fn, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await delay(150);
  }

  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
