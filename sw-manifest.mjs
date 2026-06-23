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
let targets = await getJSON('/json');
let sw = targets.find(t => t.type === 'service_worker');
if (!sw) {
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    targets = await getJSON('/json');
    sw = targets.find(t => t.type === 'service_worker');
    if (sw) break;
  }
}
if (!sw) {
  console.log('No SW found!');
  console.log('All targets:', targets.map(t => `[${t.type}] ${t.url}`));
  process.exit(1);
}
console.log('SW URL:', sw.url);
const sess = await createSession(sw.webSocketDebuggerUrl);
await sess.send('Runtime.enable');
const keepAlive = setInterval(() => sess.send('Runtime.evaluate',{expression:'1',returnByValue:true}).catch(()=>{}), 3000);
const info = await sess.send('Runtime.evaluate', {
  expression: `({
    location: location.href,
    chromeKeys: Object.keys(chrome),
    hasStorage: !!chrome.storage,
    hasContextMenus: !!chrome.contextMenus,
    hasScripting: !!chrome.scripting,
    id: chrome.runtime.id,
    manifest: chrome.runtime.getManifest()
  })`,
  returnByValue: true
});
console.log('SW info:', JSON.stringify(info.result.value, null, 2));
clearInterval(keepAlive);
sess.close();
