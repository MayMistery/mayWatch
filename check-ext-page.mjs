import { writeFileSync } from 'fs';
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
let page = targets.find(t => t.type === 'page');
const sess = await createSession(page.webSocketDebuggerUrl);
await sess.send('Page.enable');
await sess.send('Runtime.enable');
await sess.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await sess.send('Page.navigate', { url: 'chrome://extensions' });
await sleep(5000);
const result = await sess.send('Runtime.evaluate', {
  expression: `(async () => {
    function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
    await sleep(1000);
    const m = document.querySelector('extensions-manager');
    if (!m) return 'no manager';
    const list = m.shadowRoot?.querySelector('extensions-item-list');
    const items = list?.shadowRoot?.querySelectorAll('extensions-item') || [];
    const results = [];
    for (const item of items) {
      const name = item.shadowRoot?.getElementById('name')?.textContent;
      const id = item.id;
      const err = item.shadowRoot?.querySelector('.warning-icon, .error-icon, [class*=error]');
      const errText = item.shadowRoot?.querySelector('.warning-icon + span, [class*=error] + span')?.textContent;
      const state = item.shadowRoot?.querySelector('#enable-toggle')?.checked;
      results.push({ name, id, error: errText || (err ? 'error present' : null), enabled: state });
    }
    // Also enable dev mode
    const tb = m.shadowRoot?.querySelector('extensions-toolbar');
    const dt = tb?.shadowRoot?.getElementById('devMode');
    if (dt && !dt.checked) dt.click();
    await sleep(500);
    return JSON.stringify({ count: items.length, items: results, devMode: dt?.checked }, null, 2);
  })()`,
  awaitPromise: true, returnByValue: true
});
console.log('Extensions installed:', result.result.value);
const shot = await sess.send('Page.captureScreenshot', { format: 'png' });
writeFileSync('/tmp/chrome-extensions-page.png', Buffer.from(shot.data, 'base64'));
console.log('Screenshot saved to /tmp/chrome-extensions-page.png');
sess.close();
