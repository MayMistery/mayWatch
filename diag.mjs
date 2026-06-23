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
console.log('All targets:');
targets.forEach(t => console.log(`  [${t.type}] ${t.url?.substring(0,150)}`));

// Check the SW
const sw = targets.find(t => t.type === 'service_worker');
if (sw) {
  console.log('\n=== SW Info ===');
  console.log('URL:', sw.url);
  const swSess = await createSession(sw.webSocketDebuggerUrl);
  await swSess.send('Runtime.enable');
  const ka = setInterval(() => swSess.send('Runtime.evaluate',{expression:'1',returnByValue:true}).catch(()=>{}), 3000);
  const info = await swSess.send('Runtime.evaluate', {
    expression: `({
      href: location.href,
      id: chrome.runtime.id,
      manifest: chrome.runtime.getManifest ? chrome.runtime.getManifest() : null,
      chromeKeys: Object.keys(chrome).sort(),
      hasStorage: !!chrome.storage,
      hasContextMenus: !!chrome.contextMenus,
      hasScripting: !!chrome.scripting,
      hasTabs: !!chrome.tabs
    })`,
    returnByValue: true
  });
  console.log('SW details:', JSON.stringify(info.result.value, null, 2));
  clearInterval(ka);
  swSess.close();
}

// Check the page for maywatch-root
const page = targets.find(t => t.type === 'page');
if (page) {
  console.log('\n=== Page Check ===');
  const pSess = await createSession(page.webSocketDebuggerUrl);
  await pSess.send('Runtime.enable');
  const check = await pSess.send('Runtime.evaluate', {
    expression: `({
      hasMaywatchRoot: !!document.getElementById('maywatch-root'),
      host: document.getElementById('maywatch-root') ? 'found' : 'not found',
      url: location.href
    })`,
    returnByValue: true
  });
  console.log('Page check:', JSON.stringify(check.result.value, null, 2));
  pSess.close();
}
