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
const page = targets.find(t => t.type === 'page');
const sess = await createSession(page.webSocketDebuggerUrl);
await sess.send('Page.enable');
await sess.send('Runtime.enable');
if (!page.url?.startsWith('chrome://extensions')) {
  await sess.send('Page.navigate', { url: 'chrome://extensions' });
  await sleep(4000);
}
console.log('=== Step 1: Enable dev mode and intercept loadUnpacked ===');
const interceptResult = await sess.send('Runtime.evaluate', {
  expression: `(async () => {
    const poll = (fn, to=5000) => new Promise(res => {
      const s = Date.now();
      const t = () => { const r = fn(); if (r) return res(r); if (Date.now()-s > to) return res(null); requestAnimationFrame(t); };
      t();
    });
    function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
    const m = await poll(() => document.querySelector('extensions-manager'));
    if (!m) return 'ERR: no manager';
    await sleep(300);
    const tb = m.shadowRoot?.querySelector('extensions-toolbar');
    const dt = tb?.shadowRoot?.getElementById('devMode');
    if (dt && !dt.checked) { dt.click(); await sleep(1000); }
    // Intercept the API
    window.__interceptedArgs = null;
    const orig = chrome.developerPrivate.loadUnpacked;
    chrome.developerPrivate.loadUnpacked = function(...args) {
      window.__interceptedArgs = args.map(a => typeof a === 'function' ? '<callback>' : JSON.stringify(a));
      return; // prevent actual execution;
    };
    // Click the load unpacked button
    const btn = Array.from(tb.shadowRoot.querySelectorAll('cr-button'))
      .find(b => b.textContent.includes('加载未打包') || b.textContent.includes('Load unpacked'));
    if (!btn) return 'ERR: no btn';
    btn.click();
    await sleep(3000);
    return 'Intercepted args: ' + JSON.stringify(window.__interceptedArgs);
  })()`,
  awaitPromise: true, returnByValue: true
});
console.log('Result:', interceptResult.result.value);
sess.close();
