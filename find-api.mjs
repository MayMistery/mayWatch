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
if (!page.url?.startsWith('chrome://extensions')) {
  await sess.send('Page.navigate', { url: 'chrome://extensions' });
  await new Promise(r => setTimeout(r, 4000));
}
const result = await sess.send('Runtime.evaluate', {
  expression: `(async () => {
    // Find all script sources
    const scripts = [...document.querySelectorAll('script[src]')].map(s => s.src);
    // Search for loadUnpacked in all loaded modules
    const results = [];
    for (const src of scripts) {
      try {
        const r = await fetch(src);
        const text = await r.text();
        if (text.includes('loadUnpacked')) {
          // Find the relevant section
          const idx = text.indexOf('loadUnpacked');
          const context = text.substring(Math.max(0, idx - 200), idx + 300);
          results.push({ src: src.split('/').pop(), context });
        }
      } catch(e) {}
    }
    return JSON.stringify(results, null, 2);
  })()`,
  awaitPromise: true, returnByValue: true
});
console.log(result.result.value?.substring(0, 5000));
sess.close();
