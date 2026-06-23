import { writeFileSync } from 'fs';
import { execSync } from 'child_process';
async function getJSON(path) { return (await fetch(`http://127.0.0.1:9222${path}`)).json(); }
function createSession(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let id = 0;
    ws.addEventListener('open', () => resolve({
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const msgId = ++id;
          pending.set(msgId, { res, rej });
          ws.send(JSON.stringify({ id: msgId, method, params }));
        });
      },
      close() { ws.close(); },
    }));
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      }
    });
    ws.addEventListener('error', reject);
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const targets = await getJSON('/json');
let page = targets.find(t => t.type === 'page' && t.url?.includes('maywatch-test'));
if (!page) {
  page = targets.find(t => t.type === 'page');
}
console.log('Using page:', page.url);
const sess = await createSession(page.webSocketDebuggerUrl);
await sess.send('Page.enable');
await sess.send('Runtime.enable');
await sess.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
console.log('Step 1: Navigate to chrome://extensions');
await sess.send('Page.navigate', { url: 'chrome://extensions' });
await sleep(4000);
console.log('Step 2: Enable developer mode');
const devResult = await sess.send('Runtime.evaluate', {
  expression: `(async () => {
    function waitForEl(fn, timeout = 5000) {
      return new Promise(res => {
        const start = Date.now();
        const tick = () => {
          const el = fn();
          if (el) return res(el);
          if (Date.now() - start > timeout) return res(null);
          requestAnimationFrame(tick);
        };
        tick();
      });
    }
    const manager = await waitForEl(() => document.querySelector('extensions-manager'));
    if (!manager) return 'ERR: no extensions-manager';
    await new Promise(r => setTimeout(r, 500));
    const sr = manager.shadowRoot;
    if (!sr) return 'ERR: no shadowRoot on manager';
    const toolbar = sr.querySelector('extensions-toolbar');
    if (!toolbar) return 'ERR: no toolbar';
    const tsr = toolbar.shadowRoot;
    if (!tsr) return 'ERR: no toolbar shadowRoot';
    const devToggle = tsr.getElementById('devMode');
    if (!devToggle) return 'ERR: no devMode toggle';
    if (!devToggle.checked) {
      devToggle.click();
      await new Promise(r => setTimeout(r, 1000));
    }
    return 'DevMode: ' + devToggle.checked;
  })()`,
  awaitPromise: true, returnByValue: true
});
console.log('Dev mode result:', devResult.result.value);
if (devResult.result.value?.includes('ERR')) {
  const shot = await sess.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('ext-error.png', Buffer.from(shot.data, 'base64'));
  console.log('Error screenshot saved');
  process.exit(1);
}
await sleep(1000);
console.log('Step 3: Click Load Unpacked');
const loadResult = await sess.send('Runtime.evaluate', {
  expression: `(async () => {
    function waitForEl(fn, timeout = 3000) {
      return new Promise(res => {
        const start = Date.now();
        const tick = () => {
          const el = fn();
          if (el) return res(el);
          if (Date.now() - start > timeout) return res(null);
          requestAnimationFrame(tick);
        };
        tick();
      });
    }
    const manager = document.querySelector('extensions-manager');
    const toolbar = manager.shadowRoot.querySelector('extensions-toolbar');
    const loadBtn = Array.from(toolbar.shadowRoot.querySelectorAll('cr-button'))
      .find(b => b.textContent.includes('加载未打包') || b.textContent.includes('Load unpacked'));
    if (!loadBtn) return 'ERR: no load button';
    loadBtn.click();
    return 'clicked: ' + loadBtn.textContent.trim();
  })()`,
  awaitPromise: true, returnByValue: true
});
console.log('Load button result:', loadResult.result.value);
await sleep(2000);
console.log('Step 4: Use AppleScript to select the extension folder');
const extPath = '/Users/bytedance/Desktop/mayWatch-doubao-seed-2.1-pro';
try {
  execSync(`osascript -e 'tell application "Google Chrome" to activate'`, { timeout: 3000 });
  await sleep(500);
  execSync(`osascript -e 'tell application "System Events"' -e 'keystroke "g" using {shift down, command down}' -e 'delay 0.5' -e 'keystroke "${extPath}"' -e 'delay 0.3' -e 'keystroke return' -e 'delay 0.5' -e 'keystroke return' -e 'end tell'`, { timeout: 10000 });
  console.log('AppleScript executed');
} catch(e) {
  console.log('AppleScript error:', e.message?.substring(0, 300));
}
await sleep(5000);
console.log('Step 5: Check if extension loaded');
const checkResult = await sess.send('Runtime.evaluate', {
  expression: 'document.body.innerText',
  returnByValue: true
});
console.log('Extensions page text:', checkResult.result.value?.substring(0, 2000));
const shot = await sess.send('Page.captureScreenshot', { format: 'png' });
writeFileSync('after-load-ext.png', Buffer.from(shot.data, 'base64'));
console.log('Screenshot saved to after-load-ext.png');
sess.close();
