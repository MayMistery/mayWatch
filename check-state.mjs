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
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    });
    ws.addEventListener('error', reject);
  });
}
const targets = await getJSON('/json');
for (const t of targets) {
  console.log(`[${t.type}] ${t.url?.substring(0,150)}`);
}
const page = targets.find(t => t.url?.includes('maywatch-test'));
if (page) {
  const sess = await createSession(page.webSocketDebuggerUrl);
  await sess.send('Runtime.enable');
  const r1 = await sess.send('Runtime.evaluate', { expression: 'document.getElementById("maywatch-root") ? "INJECTED" : "NOT_INJECTED"', returnByValue: true });
  console.log('\nContent script #maywatch-root:', r1.result.value);
  const r2 = await sess.send('Runtime.evaluate', { expression: 'window.__maywatch_injected ? "FLAG_SET" : "NO_FLAG"', returnByValue: true });
  console.log('Injection flag:', r2.result.value);
  sess.close();
}
const sw = targets.find(t => t.type === 'service_worker');
if (sw) {
  console.log('\nSW URL:', sw.url);
  const swSess = await createSession(sw.webSocketDebuggerUrl);
  await swSess.send('Runtime.enable');
  try {
    const r3 = await swSess.send('Runtime.evaluate', { expression: 'typeof chrome !== "undefined" && chrome.storage ? "CHROME_OK" : "NO_CHROME"', returnByValue: true });
    console.log('SW chrome API:', r3.result.value);
    const r4 = await swSess.send('Runtime.evaluate', { expression: '(async()=>{const t=await chrome.storage.local.get(null);const keys=Object.keys(t);return JSON.stringify({keys, taskCount:(t.tasks||[]).length});})()', awaitPromise: true, returnByValue: true });
    console.log('SW storage keys:', r4.result.value);
  } catch(e) {
    console.log('SW eval error:', e.message);
  }
  swSess.close();
}
