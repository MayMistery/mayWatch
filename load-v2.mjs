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
console.log('Current targets:', targets.map(t => `[${t.type}] ${t.url?.substring(0,80)}`).join(', '));
let page = targets.find(t => t.type === 'page');
const sess = await createSession(page.webSocketDebuggerUrl);
await sess.send('Page.enable');
await sess.send('Runtime.enable');
await sess.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
console.log('\nNavigating to chrome://extensions...');
await sess.send('Page.navigate', { url: 'chrome://extensions' });
await sleep(5000);
const url = await sess.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
console.log('Current URL:', url.result.value);
const shot0 = await sess.send('Page.captureScreenshot', { format: 'png' });
writeFileSync('ext-nav.png', Buffer.from(shot0.data, 'base64'));
console.log('\n=== Enabling developer mode ===');
const devResult = await sess.send('Runtime.evaluate', {
  expression: `(async () => {
    const poll = (fn, to=5000) => new Promise(res => {
      const s = Date.now();
      const t = () => { const r = fn(); if (r) return res(r); if (Date.now()-s > to) return res(null); requestAnimationFrame(t); };
      t();
    });
    const m = await poll(() => document.querySelector('extensions-manager'));
    if (!m) return 'ERR: no manager';
    await new Promise(r => setTimeout(r, 500));
    const tb = m.shadowRoot?.querySelector('extensions-toolbar');
    if (!tb) return 'ERR: no toolbar in manager shadow';
    const dt = tb.shadowRoot?.getElementById('devMode');
    if (!dt) {
      const allToggles = [...tb.shadowRoot?.querySelectorAll('cr-toggle')].map(t=>t.id);
      return 'ERR: no dev toggle, found: ' + allToggles.join(',');
    }
    if (!dt.checked) { dt.click(); await new Promise(r => setTimeout(r, 1000)); }
    return 'devMode=' + dt.checked;
  })()`,
  awaitPromise: true, returnByValue: true
});
console.log('DevMode:', devResult.result.value);
await sleep(1000);
console.log('\n=== Clicking Load Unpacked ===');
const clickResult = await sess.send('Runtime.evaluate', {
  expression: `(async () => {
    const m = document.querySelector('extensions-manager');
    const tb = m.shadowRoot.querySelector('extensions-toolbar');
    const btn = Array.from(tb.shadowRoot.querySelectorAll('cr-button'))
      .find(b => b.textContent.includes('加载未打包') || b.textContent.includes('Load unpacked'));
    if (!btn) return 'ERR: no load button';
    btn.click();
    return 'clicked';
  })()`,
  awaitPromise: true, returnByValue: true
});
console.log('Click:', clickResult.result.value);
await sleep(2000);
const shot1 = await sess.send('Page.captureScreenshot', { format: 'png' });
writeFileSync('ext-dialog.png', Buffer.from(shot1.data, 'base64'));
console.log('Dialog screenshot saved');
console.log('\n=== Running AppleScript ===');
try {
  const result = execSync('osascript /tmp/select_folder.applescript', { timeout: 25000, stdio: ['pipe','pipe','pipe'] }).toString().trim();
  console.log('AppleScript:', result);
} catch(e) {
  console.log('AppleScript stdout:', e.stdout?.toString());
  console.log('AppleScript stderr:', e.stderr?.toString()?.substring(0,200));
  console.log('AppleScript error:', e.message?.substring(0, 200));
}
await sleep(5000);
console.log('\n=== Checking result ===');
const targets2 = await getJSON('/json');
console.log('Targets:', targets2.length);
targets2.forEach(t => console.log(`  [${t.type}] ${t.url?.substring(0,120)}`));
const shot2 = await sess.send('Page.captureScreenshot', { format: 'png' });
writeFileSync('ext-after.png', Buffer.from(shot2.data, 'base64'));
const text = await sess.send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true });
console.log('Page text:', text.result.value?.substring(0, 1500));
sess.close();
