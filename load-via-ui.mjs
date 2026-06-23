import { writeFileSync, execSync } from 'child_process';
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
const extPath = '/Users/bytedance/Desktop/mayWatch-doubao-seed-2.1-pro';
const targets = await getJSON('/json');
let page = targets.find(t => t.type === 'page');
const sess = await createSession(page.webSocketDebuggerUrl);
await sess.send('Page.enable');
await sess.send('Runtime.enable');
await sess.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
if (!page.url?.startsWith('chrome://extensions')) {
  await sess.send('Page.navigate', { url: 'chrome://extensions' });
  await sleep(4000);
}
console.log('=== Clicking Load Unpacked button ===');
const clickResult = await sess.send('Runtime.evaluate', {
  expression: `(async () => {
    function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
    await sleep(500);
    const m = document.querySelector('extensions-manager');
    if (!m) return 'ERR: no manager';
    const tb = m.shadowRoot?.querySelector('extensions-toolbar');
    // Ensure dev mode is on
    const dt = tb?.shadowRoot?.getElementById('devMode');
    if (dt && !dt.checked) { dt.click(); await sleep(1000); }
    // Find and click load unpacked button
    const buttons = Array.from(tb?.shadowRoot?.querySelectorAll('cr-button') || []);
    const loadBtn = buttons.find(b => {
      const t = b.textContent?.trim() || '';
      return t.includes('加载') || t.toLowerCase().includes('load unpacked');
    });
    if (!loadBtn) {
      const allBtns = buttons.map(b => b.textContent?.trim());
      return 'ERR: no load btn. Buttons: ' + JSON.stringify(allBtns);
    }
    loadBtn.click();
    return 'clicked: ' + loadBtn.textContent?.trim();
  })()`,
  awaitPromise: true, returnByValue: true
});
console.log('Click result:', clickResult.result.value);
await sleep(2000);
// Now the file dialog should be open. Use cliclick to type Cmd+Shift+G, then path, then Enter.
console.log('\n=== Using cliclick to navigate file dialog ===');
try {
  // Cmd+Shift+G opens "Go to folder" in macOS file dialogs
  execSync('/opt/homebrew/bin/cliclick kd:cmd kp:shift kp:g ku:shift ku:cmd', { stdio: 'inherit' });
  await sleep(800);
  // Type the extension path
  execSync(`/opt/homebrew/bin/cliclick t:"${extPath}"`, { stdio: 'inherit' });
  await sleep(500);
  // Press Enter to confirm "Go"
  execSync('/opt/homebrew/bin/cliclick kp:enter', { stdio: 'inherit' });
  await sleep(800);
  // Press Enter to confirm "Open"
  execSync('/opt/homebrew/bin/cliclick kp:enter', { stdio: 'inherit' });
  console.log('cliclick commands sent');
} catch(e) {
  console.log('cliclick error (likely accessibility permissions):', e.message?.substring(0, 300));
}
await sleep(3000);
// Check if extension loaded
const targets2 = await getJSON('/json');
console.log('\n=== Targets after load attempt ===');
const swTargets = targets2.filter(t => t.type === 'service_worker');
for (const t of swTargets) {
  console.log('SW:', t.url?.substring(0, 200));
}
const pageTarget = targets2.find(t => t.type === 'page');
const pageSess = await createSession(pageTarget.webSocketDebuggerUrl);
await pageSess.send('Page.enable');
await pageSess.send('Runtime.enable');
const pageUrl = await pageSess.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
console.log('Page URL:', pageUrl.result.value);
// Navigate back to extensions to check
if (!pageUrl.result.value?.includes('extensions')) {
  await pageSess.send('Page.navigate', { url: 'chrome://extensions' });
  await sleep(3000);
}
const extCheck = await pageSess.send('Runtime.evaluate', {
  expression: `(() => {
    const m = document.querySelector('extensions-manager');
    const list = m?.shadowRoot?.querySelector('extensions-item-list');
    const items = list?.shadowRoot?.querySelectorAll('extensions-item') || [];
    const results = [];
    for (const item of items) {
      results.push({
        name: item.shadowRoot?.getElementById('name')?.textContent,
        id: item.id,
        enabled: item.shadowRoot?.querySelector('#enable-toggle')?.checked,
        errors: item.shadowRoot?.querySelector('[class*=error]')?.textContent?.substring(0,200)
      });
    }
    return JSON.stringify(results, null, 2);
  })()`,
  returnByValue: true
});
console.log('Extensions after load:', extCheck.result.value);
const shot = await pageSess.send('Page.captureScreenshot', { format: 'png' });
writeFileSync('/tmp/after-ui-load.png', Buffer.from(shot.data, 'base64'));
console.log('Screenshot saved');
pageSess.close();
sess.close();
