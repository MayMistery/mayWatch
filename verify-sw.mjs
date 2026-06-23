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
for (const t of targets) {
  console.log(`[${t.type}] ${t.url}`);
}
const sw = targets.find(t => t.type === 'service_worker');
if (sw) {
  console.log('\nConnecting to SW:', sw.url);
  const sess = await createSession(sw.webSocketDebuggerUrl);
  await sess.send('Runtime.enable');
  // Check location
  const loc = await sess.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
  console.log('SW location:', loc.result.value);
  // Check if our functions exist
  const fns = await sess.send('Runtime.evaluate', {
    expression: `({
      hasScheduler: typeof scheduleCheck !== 'undefined',
      hasAddTask: typeof addTask !== 'undefined',
      hasIsPlaceholder: typeof isPlaceholderContent !== 'undefined',
      hasStorage: typeof chrome !== 'undefined' && !!chrome.storage,
      keys: Object.keys(globalThis).filter(k => k.includes('ask') || k.includes('diff') || k.includes('numeric') || k.includes('torage')).slice(0, 30)
    })`,
    returnByValue: true
  });
  console.log('SW globals:', JSON.stringify(fns.result.value, null, 2));
  // Check import.meta or module info
  try {
    const modInfo = await sess.send('Runtime.evaluate', {
      expression: '(async()=>{try{const st=await chrome.storage.local.get(null);return {storageKeys:Object.keys(st),tasks:st.tasks?.length||0};}catch(e){return {error:e.message};}})()',
      awaitPromise: true, returnByValue: true
    });
    console.log('Storage state:', JSON.stringify(modInfo.result.value));
  } catch(e) {
    console.log('Storage error:', e.message);
  }
  sess.close();
}
const page = targets.find(t => t.url?.includes('maywatch-test'));
if (page) {
  console.log('\nConnecting to page...');
  const pSess = await createSession(page.webSocketDebuggerUrl);
  await pSess.send('Runtime.enable');
  const host = await pSess.send('Runtime.evaluate', {
    expression: 'document.getElementById("maywatch-root") ? "MAYWATCH_HOST_FOUND" : "NO_HOST"',
    returnByValue: true
  });
  console.log('Page content script check:', host.result.value);
  // Check for content script injection marker
  const marker = await pSess.send('Runtime.evaluate', {
    expression: `(() => {
      const h = document.getElementById('maywatch-root');
      if (!h) return 'no host element';
      return {
        hasHost: true,
        shadowRootType: h.shadowRoot === null ? 'closed_or_none' : 'open',
        childCount: h.children.length
      };
    })()`,
    returnByValue: true
  });
  console.log('Host details:', JSON.stringify(marker.result.value));
  pSess.close();
}
