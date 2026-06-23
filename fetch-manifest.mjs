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
const page = targets.find(t => t.type === 'page');
const sess = await createSession(page.webSocketDebuggerUrl);
await sess.send('Page.enable');
await sess.send('Runtime.enable');
const extId = 'fignfifoniblkonapihmkfakmlgkbkcf';
console.log('=== Fetching manifest.json from extension ===');
const manifest = await sess.send('Runtime.evaluate', {
  expression: `(async () => {
    try {
      const r = await fetch('chrome-extension://${extId}/manifest.json');
      const text = await r.text();
      return text;
    } catch(e) {
      return 'ERROR: ' + e.message;
    }
  })()`,
  awaitPromise: true, returnByValue: true
});
console.log(manifest.result.value?.substring(0, 2000));
console.log('\n=== Fetching background/service-worker.js ===');
const swContent = await sess.send('Runtime.evaluate', {
  expression: `(async () => {
    try {
      const r = await fetch('chrome-extension://${extId}/background/service-worker.js');
      const text = await r.text();
      return 'length: ' + text.length + ', starts with: ' + text.substring(0, 200);
    } catch(e) {
      return 'ERROR: ' + e.message;
    }
  })()`,
  awaitPromise: true, returnByValue: true
});
console.log(swContent.result.value);
console.log('\n=== Fetching service_worker.js ===');
const sw2 = await sess.send('Runtime.evaluate', {
  expression: `(async () => {
    try {
      const r = await fetch('chrome-extension://${extId}/service_worker.js');
      const text = await r.text();
      return 'length: ' + text.length + ', starts with: ' + text.substring(0, 200);
    } catch(e) {
      return 'ERROR: ' + e.message;
    }
  })()`,
  awaitPromise: true, returnByValue: true
});
console.log(sw2.result.value);
sess.close();
