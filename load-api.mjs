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
let page = targets.find(t => t.type === 'page' && t.url?.startsWith('chrome://extensions'));
if (!page) page = targets.find(t => t.type === 'page');
const sess = await createSession(page.webSocketDebuggerUrl);
await sess.send('Page.enable');
await sess.send('Runtime.enable');
if (!page.url?.startsWith('chrome://extensions')) {
  await sess.send('Page.navigate', { url: 'chrome://extensions' });
  await sleep(4000);
}
console.log('Current URL:', (await sess.send('Runtime.evaluate', {expression:'location.href',returnByValue:true})).result.value);
console.log('\n=== Trying developerPrivate API ===');
const result = await sess.send('Runtime.evaluate', {
  expression: `(async () => {
    if (typeof chrome === 'undefined') return 'no chrome';
    if (!chrome.developerPrivate) return 'no developerPrivate API';
    const api = chrome.developerPrivate;
    const methods = Object.keys(api).filter(k => typeof api[k] === 'function');
    return 'Available methods: ' + methods.join(', ');
  })()`,
  awaitPromise: true, returnByValue: true
});
console.log('API check:', result.result.value);
console.log('\n=== Trying to load extension via API ===');
const extPath = '/Users/bytedance/Desktop/mayWatch-doubao-seed-2.1-pro';
const loadResult = await sess.send('Runtime.evaluate', {
  expression: `(async () => {
    try {
      const api = chrome.developerPrivate;
      if (!api || !api.loadUnpacked) {
        return 'loadUnpacked not available, trying loadDirectory...';
      }
      const result = await new Promise((resolve, reject) => {
        api.loadUnpacked('${extPath}', (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(res);
          }
        });
      });
      return 'loadUnpacked result: ' + JSON.stringify(result);
    } catch(e) {
      return 'Error: ' + e.message;
    }
  })()`,
  awaitPromise: true, returnByValue: true
});
console.log('Load result:', loadResult.result.value);
await sleep(3000);
const targets2 = await getJSON('/json');
console.log('\nTargets after load attempt:', targets2.length);
targets2.forEach(t => console.log(`  [${t.type}] ${t.url?.substring(0,150)}`));
const shot = await sess.send('Page.captureScreenshot', { format: 'png' });
writeFileSync('ext-api-test.png', Buffer.from(shot.data, 'base64'));
sess.close();
