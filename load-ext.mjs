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
const targets = await getJSON('/json');
let page = targets.find(t => t.url?.startsWith('chrome://extensions')) || targets.find(t => t.type === 'page');
const sess = await createSession(page.webSocketDebuggerUrl);
await sess.send('Page.enable');
await sess.send('DOM.enable');
await sess.send('Runtime.enable');
await sess.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
console.log('Step 1: Enable developer mode');
const enableDev = await sess.send('Runtime.evaluate', {
  expression: `(async () => {
    function waitFor(selectorFn, timeout = 3000) {
      return new Promise((resolve) => {
        const start = Date.now();
        const check = () => {
          const el = selectorFn();
          if (el) resolve(el);
          else if (Date.now() - start > timeout) resolve(null);
          else requestAnimationFrame(check);
        };
        check();
      });
    }
    const manager = await waitFor(() => document.querySelector('extensions-manager'));
    if (!manager) return 'no manager';
    await new Promise(r => requestAnimationFrame(r));
    const toolbar = manager.shadowRoot?.querySelector('extensions-toolbar');
    if (!toolbar) return 'no toolbar';
    const devToggle = toolbar.shadowRoot?.getElementById('devMode');
    if (!devToggle) return 'no devToggle';
    if (!devToggle.checked) devToggle.click();
    await new Promise(r => setTimeout(r, 500));
    return 'devMode enabled: ' + devToggle.checked;
  })()`,
  awaitPromise: true, returnByValue: true
});
console.log('Result:', enableDev.result.value);
await new Promise(r => setTimeout(r, 1000));
console.log('Step 2: Click Load Unpacked button');
const clickLoad = await sess.send('Runtime.evaluate', {
  expression: `(async () => {
    function waitFor(selectorFn, timeout = 3000) {
      return new Promise((resolve) => {
        const start = Date.now();
        const check = () => {
          const el = selectorFn();
          if (el) resolve(el);
          else if (Date.now() - start > timeout) resolve(null);
          else requestAnimationFrame(check);
        };
        check();
      });
    }
    const manager = document.querySelector('extensions-manager');
    const toolbar = manager?.shadowRoot?.querySelector('extensions-toolbar');
    if (!toolbar) return 'no toolbar';
    const loadBtn = Array.from(toolbar.shadowRoot?.querySelectorAll('cr-button') || [])
      .find(b => b.textContent.includes('加载未打包') || b.textContent.includes('Load unpacked'));
    if (!loadBtn) {
      const buttons = Array.from(toolbar.shadowRoot?.querySelectorAll('cr-button') || []).map(b => b.textContent);
      return 'no load btn, found: ' + buttons.join('|');
    }
    loadBtn.click();
    return 'clicked load unpacked';
  })()`,
  awaitPromise: true, returnByValue: true
});
console.log('Result:', clickLoad.result.value);
await new Promise(r => setTimeout(r, 1500));
console.log('Step 3: Use AppleScript to select the extension folder');
const extensionPath = '/Users/bytedance/Desktop/mayWatch-doubao-seed-2.1-pro';
try {
  execSync(`osascript -e 'tell application "System Events" to keystroke "${extensionPath}"' -e 'tell application "System Events" to keystroke return'`, { timeout: 5000 });
  console.log('AppleScript sent keystrokes');
} catch(e) {
  console.log('AppleScript error:', e.message?.substring(0, 200));
}
await new Promise(r => setTimeout(r, 3000));
const shot = await sess.send('Page.captureScreenshot', { format: 'png' });
import { writeFileSync } from 'fs';
writeFileSync('after-load.png', Buffer.from(shot.data, 'base64'));
console.log('Screenshot saved');
const text = await sess.send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true });
console.log('Page text:', text.result.value?.substring(0, 2000));
sess.close();
