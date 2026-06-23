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
const extPath = '/Users/bytedance/Desktop/mayWatch-doubao-seed-2.1-pro';
async function tryCall(desc, expr) {
  const r = await sess.send('Runtime.evaluate', {
    expression: `(async () => { try { ${expr} } catch(e) { return 'ERR: ' + e.message; } })()`,
    awaitPromise: true, returnByValue: true
  });
  console.log(desc + ':', r.result.value);
  return r.result.value;
}
console.log('=== Probing API signatures ===');
await tryCall('chooseType()', `return await new Promise(r=>chrome.developerPrivate.choosePath(result=>r('cb:'+JSON.stringify(result))));`);
await sleep(500);
await tryCall('chooseFile(folder,file)', `return await new Promise(r=>chrome.developerPrivate.choosePath('folder','file',result=>r('cb:'+JSON.stringify(result))));`);
await sleep(500);
// Try loadUnpacked with various options
await tryCall('loadUnpacked(no args)', `return await new Promise(r=>chrome.developerPrivate.loadUnpacked(result=>{if(chrome.runtime.lastError)r('err:'+chrome.runtime.lastError.message);else r('cb:'+JSON.stringify(result));}));`);
await sleep(2000);
// Try inspecting what choosePath returns - check if dialog appeared
const dialogResult = await sess.send('Runtime.evaluate', {
  expression: `(() => {
    const m = document.querySelector('extensions-manager');
    return m ? 'manager found' : 'no manager';
  })()`,
  returnByValue: true
});
console.log('Manager:', dialogResult.result.value);
sess.close();
