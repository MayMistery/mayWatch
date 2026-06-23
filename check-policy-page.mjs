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
const page = targets.find(t => t.type === 'page') || (() => { throw new Error('No page'); })();
const sess = await createSession(page.webSocketDebuggerUrl);
await sess.send('Page.enable');
await sess.send('Runtime.enable');
await sess.send('Page.navigate', { url: 'chrome://policy' });
await sleep(5000);
const policies = await sess.send('Runtime.evaluate', {
  expression: `(async () => {
    function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
    await sleep(2000);
    const tables = document.querySelectorAll('policy-table');
    let result = [];
    for (const t of tables) {
      const rows = t.shadowRoot?.querySelectorAll('.policy-data') || [];
      for (const r of rows) {
        const name = r.querySelector('.name')?.textContent?.trim();
        const value = r.querySelector('.value')?.textContent?.trim()?.substring(0, 200);
        const scope = r.querySelector('.scope')?.textContent?.trim();
        if (name && name.toLowerCase().includes('extension') || name?.toLowerCase().includes('developer')) {
          result.push({ name, value, scope });
        }
      }
    }
    return JSON.stringify(result, null, 2);
  })()`,
  awaitPromise: true, returnByValue: true
});
console.log('Extension/Dev policies:', policies.result.value);
const shot = await sess.send('Page.captureScreenshot', { format: 'png' });
writeFileSync('policy-page.png', Buffer.from(shot.data, 'base64'));
sess.close();
