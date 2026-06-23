async function getJSON(path) {
  return (await fetch(`http://127.0.0.1:9222${path}`)).json();
}
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
        if (msg.error) rej(new Error(msg.error.message + ': ' + JSON.stringify(msg.error.data)));
        else res(msg.result);
      }
    });
    ws.addEventListener('error', reject);
  });
}
const targets = await getJSON('/json');
console.log('Targets:');
for (const t of targets) console.log(`  [${t.type}] ${t.url}`);
const page = targets.find(t => t.type === 'page');
const sess = await createSession(page.webSocketDebuggerUrl);
await sess.send('Page.enable');
console.log('\nNavigating to chrome://extensions...');
await sess.send('Page.navigate', { url: 'chrome://extensions' });
await new Promise(r => setTimeout(r, 3000));
const urls = (await getJSON('/json')).map(t => `[${t.type}] ${t.url?.substring(0,120)}`);
console.log('After navigation targets:');
urls.forEach(u => console.log(' ', u));
sess.close();
