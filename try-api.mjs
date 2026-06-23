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
const page = targets.find(t => t.type === 'page');
const sess = await createSession(page.webSocketDebuggerUrl);
await sess.send('Page.enable');
await sess.send('Runtime.enable');
const extPath = '/Users/bytedance/Desktop/mayWatch-doubao-seed-2.1-pro';
async function tryLoad(desc, fn) {
  const r = await sess.send('Runtime.evaluate', {
    expression: `(async () => { try { ${fn} } catch(e) { return 'ERR: ' + e.message; } })()`,
    awaitPromise: true, returnByValue: true
  });
  console.log(desc + ':', r.result.value);
}
await tryLoad('try loadUnpacked({path})', `
  return await new Promise((resolve, reject) => {
    chrome.developerPrivate.loadUnpacked({path: '${extPath}'}, (res) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve('OK: ' + JSON.stringify(res));
    });
  });
`);
await sleep(2000);
await tryLoad('try loadUnpacked({filePath})', `
  return await new Promise((resolve, reject) => {
    chrome.developerPrivate.loadUnpacked({filePath: '${extPath}'}, (res) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve('OK: ' + JSON.stringify(res));
    });
  });
`);
await sleep(2000);
await tryLoad('try choosePath then load', `
  return await new Promise((resolve, reject) => {
    chrome.developerPrivate.choosePath('folder', (path) => {
      if (chrome.runtime.lastError) reject(new Error('choosePath: ' + chrome.runtime.lastError.message));
      else resolve('chosen: ' + path);
    });
  });
`);
await sleep(2000);
const targets2 = await getJSON('/json');
console.log('\nTargets:');
targets2.forEach(t => console.log(`  [${t.type}] ${t.url?.substring(0,150)}`));
sess.close();
