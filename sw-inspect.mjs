async function getJSON(path) { return (await fetch(`http://127.0.0.1:9222${path}`)).json(); }
function createSession(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let id = 0;
    const listeners = {};
    ws.addEventListener('open', () => resolve({
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const msgId = ++id;
          pending.set(msgId, { res, rej });
          ws.send(JSON.stringify({ id: msgId, method, params }));
        });
      },
      on(method, cb) { listeners[method] = cb; },
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
      if (listeners[msg.method]) listeners[msg.method](msg.params);
    });
    ws.addEventListener('error', reject);
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let targets = await getJSON('/json');
console.log('Initial targets:', targets.length);
targets.forEach(t => console.log(`  [${t.type}] ${t.url?.substring(0,120)}`));
let sw = targets.find(t => t.type === 'service_worker');
if (!sw) {
  console.log('SW not found. Waiting and polling...');
  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    targets = await getJSON('/json');
    sw = targets.find(t => t.type === 'service_worker');
    if (sw) {
      console.log('SW appeared after', i+1, 'seconds');
      break;
    }
  }
}
if (!sw) {
  console.log('No service worker found after waiting.');
  const page = targets.find(t => t.type === 'page');
  const pSess = await createSession(page.webSocketDebuggerUrl);
  await pSess.send('Runtime.enable');
  const r = await pSess.send('Runtime.evaluate', {
    expression: 'document.documentElement.outerHTML.substring(0,500)',
    returnByValue: true
  });
  console.log('Page HTML start:', r.result.value?.substring(0,500));
  pSess.close();
  process.exit(1);
}
console.log('\nConnecting to SW:', sw.url);
const swSess = await createSession(sw.webSocketDebuggerUrl);
await swSess.send('Runtime.enable');
await swSess.send('Debugger.enable');
swSess.on('Runtime.exceptionThrown', (params) => {
  console.log('SW EXCEPTION:', JSON.stringify(params.exceptionDetails, null, 2));
});
swSess.on('Runtime.consoleAPICalled', (params) => {
  console.log('SW CONSOLE:', params.type, params.args?.map(a => a.value || JSON.stringify(a)).join(' '));
});
console.log('Waiting 3 seconds for any errors...');
const loc = await swSess.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
console.log('SW location:', loc.result.value);
try {
  const chromeCheck = await swSess.send('Runtime.evaluate', { expression: 'typeof chrome !== "undefined"', returnByValue: true });
  console.log('Has chrome:', chromeCheck.result.value);
  if (chromeCheck.result.value) {
    const keys = await swSess.send('Runtime.evaluate', {
      expression: 'Object.keys(chrome).join(",")', returnByValue: true
    });
    console.log('chrome keys:', keys.result.value);
  }
} catch(e) {
  console.log('Chrome check error:', e.message);
}
// Keep SW alive by sending periodic pings
const keepAlive = setInterval(async () => {
  try {
    await swSess.send('Runtime.evaluate', { expression: '1', returnByValue: true });
  } catch {}
}, 5000);
console.log('\nWaiting 10 seconds for errors, checking storage...');
await sleep(2000);
try {
  const storage = await swSess.send('Runtime.evaluate', {
    expression: '(async()=>{try{const r=await chrome.storage.local.get(null);return {keys:Object.keys(r)};}catch(e){return {err:e.message};}})()',
    awaitPromise: true, returnByValue: true
  });
  console.log('Storage:', storage.result.value);
} catch(e) {
  console.log('Storage error:', e.message);
}
await sleep(8000);
clearInterval(keepAlive);
console.log('\nFinal check - page content script:');
const page = targets.find(t => t.type === 'page');
const pSess = await createSession(page.webSocketDebuggerUrl);
await pSess.send('Runtime.enable');
const host = await pSess.send('Runtime.evaluate', {
  expression: `(() => {
    const h = document.getElementById('maywatch-root');
    if (!h) return 'no maywatch-root';
    return { hasHost: true, shadowType: h.shadowRoot === null ? 'closed' : 'open' };
  })()`,
  returnByValue: true
});
console.log('Content script:', JSON.stringify(host.result.value));
pSess.close();
swSess.close();
