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
const page = targets.find(t => t.type === 'page' && t.url?.startsWith('chrome://extensions')) || targets.find(t => t.type === 'page');
const sess = await createSession(page.webSocketDebuggerUrl);
await sess.send('Page.enable');
await sess.send('Runtime.enable');
console.log('URL:', (await sess.send('Runtime.evaluate',{expression:'location.href',returnByValue:true})).result.value);
const extPath = '/Users/bytedance/Desktop/mayWatch-doubao-seed-2.1-pro';
console.log('=== Trying loadDirectory ===');
const r1 = await sess.send('Runtime.evaluate', {
  expression: `(async () => {
    try {
      const api = chrome.developerPrivate;
      const result = await new Promise((resolve, reject) => {
        api.loadDirectory('${extPath}', (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(res);
          }
        });
      });
      return 'SUCCESS: ' + JSON.stringify(result);
    } catch(e) {
      return 'FAIL: ' + e.message;
    }
  })()`,
  awaitPromise: true, returnByValue: true
});
console.log('loadDirectory:', r1.result.value);
await sleep(4000);
const targets2 = await getJSON('/json');
console.log('\nTargets after loadDirectory:');
targets2.forEach(t => console.log(`  [${t.type}] ${t.url?.substring(0,150)}`));
const sw = targets2.find(t => t.type === 'service_worker' && t.url?.includes('background'));
console.log('\nOur SW found?', sw ? 'YES: ' + sw.url : 'NO');
const text = await sess.send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true });
console.log('\nPage text:', text.result.value?.substring(0, 1500));
const shot = await sess.send('Page.captureScreenshot', { format: 'png' });
writeFileSync('after-loaddir.png', Buffer.from(shot.data, 'base64'));
console.log('Screenshot saved');
sess.close();
