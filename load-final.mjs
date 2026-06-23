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
if (!page.url?.startsWith('chrome://extensions')) {
  await sess.send('Page.navigate', { url: 'chrome://extensions' });
  await sleep(4000);
}
console.log('=== Enabling developer mode ===');
const devResult = await sess.send('Runtime.evaluate', {
  expression: `(async () => {
    const poll = (fn, to=5000) => new Promise(res => {
      const s = Date.now();
      const t = () => { const r = fn(); if (r) return res(r); if (Date.now()-s > to) return res(null); requestAnimationFrame(t); };
      t();
    });
    const m = await poll(() => document.querySelector('extensions-manager'));
    if (!m) return 'ERR: no manager';
    await sleep(300);
    function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
    const tb = m.shadowRoot?.querySelector('extensions-toolbar');
    if (!tb) return 'ERR: no toolbar';
    const dt = tb.shadowRoot?.getElementById('devMode');
    if (!dt) return 'ERR: no dev toggle';
    if (!dt.checked) { dt.click(); await sleep(1000); }
    return 'devMode=' + dt.checked;
  })()`,
  awaitPromise: true, returnByValue: true
});
console.log('DevMode:', devResult.result.value);
await sleep(1000);
const extPath = '/Users/bytedance/Desktop/mayWatch-doubao-seed-2.1-pro';
async function tryLoad(desc, expr) {
  const r = await sess.send('Runtime.evaluate', {
    expression: `(async () => { try { ${expr} } catch(e) { return 'ERR: ' + e.message; } })()`,
    awaitPromise: true, returnByValue: true
  });
  console.log(desc + ':', r.result.value);
  return r.result.value;
}
console.log('\n=== Trying loadUnpacked with options ===');
await tryLoad('loadUnpacked({path:"..."})', `
  return await new Promise((resolve, reject) => {
    chrome.developerPrivate.loadUnpacked({path: '${extPath}'}, (res) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve('OK: ' + JSON.stringify(res));
    });
  });
`);
await sleep(3000);
const targets2 = await getJSON('/json');
console.log('\nTargets after load attempt:');
targets2.forEach(t => console.log(`  [${t.type}] ${t.url?.substring(0,150)}`));
const sw = targets2.find(t => t.type === 'service_worker' && t.url?.includes('background'));
console.log('\nOur SW (background/service-worker.js)?', sw ? 'YES: ' + sw.url : 'NO');
const shot = await sess.send('Page.captureScreenshot', { format: 'png' });
writeFileSync('after-load-try.png', Buffer.from(shot.data, 'base64'));
sess.close();
