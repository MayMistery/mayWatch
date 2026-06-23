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
await sess.send('Runtime.enable');
const result = await sess.send('Runtime.evaluate', {
  expression: `(() => {
    const api = chrome.developerPrivate;
    const getProps = (obj) => {
      const props = {};
      for (const k of Object.getOwnPropertyNames(obj)) {
        const v = obj[k];
        if (typeof v === 'function') {
          props[k] = v.toString().substring(0, 200);
        }
      }
      return props;
    };
    return JSON.stringify(getProps(api), null, 2);
  })()`,
  returnByValue: true
});
console.log(result.result.value);
sess.close();
