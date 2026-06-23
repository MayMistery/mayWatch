import { writeFileSync } from 'fs';
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
      on(event, cb) { listeners[event] = cb; },
      close() { ws.close(); },
    }));
    const listeners = {};
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
      if (listeners[msg.method]) listeners[msg.method](msg.params);
    });
    ws.addEventListener('error', reject);
  });
}
const targets = await getJSON('/json');
const page = targets.find(t => t.url?.startsWith('chrome://extensions') || t.url?.includes('maywatch-test'));
console.log('Using page:', page.url);
const sess = await createSession(page.webSocketDebuggerUrl);
await sess.send('Page.enable');
if (!page.url.startsWith('chrome://extensions')) {
  await sess.send('Page.navigate', { url: 'chrome://extensions' });
  await new Promise(r => setTimeout(r, 3000));
}
await sess.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
const shot = await sess.send('Page.captureScreenshot', { format: 'png' });
writeFileSync('extensions-screenshot.png', Buffer.from(shot.data, 'base64'));
console.log('Screenshot saved to extensions-screenshot.png');
const r = await sess.send('Runtime.evaluate', { expression: 'document.body.innerText.substring(0,2000)', returnByValue: true });
console.log('\nExtensions page text:\n', r.result.value);
sess.close();
