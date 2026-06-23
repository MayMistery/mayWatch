import { writeFileSync } from 'fs';
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
let page = targets.find(t => t.url?.startsWith('chrome://extensions'));
if (!page) {
  page = targets.find(t => t.type === 'page');
  const sess = await createSession(page.webSocketDebuggerUrl);
  await sess.send('Page.navigate', { url: 'chrome://extensions' });
  await new Promise(r => setTimeout(r, 3000));
  await sess.close();
  const newTargets = await getJSON('/json');
  page = newTargets.find(t => t.url?.startsWith('chrome://extensions'));
}
console.log('Page:', page.url);
const sess = await createSession(page.webSocketDebuggerUrl);
await sess.send('Page.enable');
await sess.send('DOM.enable');
await sess.send('Runtime.enable');
const doc = await sess.send('DOM.getDocument', { depth: -1, pierce: true });
function findNodes(node, predicate, results = []) {
  if (predicate(node)) results.push(node);
  if (node.children) node.children.forEach(c => findNodes(c, predicate, results));
  if (node.shadowRoots) node.shadowRoots.forEach(sr => findNodes(sr, predicate, results));
  if (node.contentDocument) findNodes(node.contentDocument, predicate, results);
  return results;
}
const toggle = findNodes(doc.root, n =>
  n.localName === 'extensions-toggle-row' ||
  (n.attributes && n.attributes.some(a => a.includes('devMode') || a.includes('developer'))) ||
  (n.localName === 'cr-toggle')
);
console.log('Potential toggle nodes:', toggle.map(t => ({localName: t.localName, nodeId: t.nodeId, attrs: t.attributes})));
const devModeButton = await sess.send('Runtime.evaluate', {
  expression: `(() => {
    const toolbar = document.querySelector('extensions-toolbar');
    if (!toolbar) return 'no toolbar';
    const sr = toolbar.shadowRoot;
    if (!sr) return 'no shadow root';
    const toggle = sr.querySelector('#devMode');
    if (!toggle) {
      const allToggles = [...sr.querySelectorAll('cr-toggle')];
      return 'toggles: ' + allToggles.map(t => t.id + ':' + t.checked).join(',');
    }
    toggle.click();
    return 'clicked devMode toggle';
  })()`,
  returnByValue: true
});
console.log('Toggle result:', devModeButton.result.value);
await new Promise(r => setTimeout(r, 1500));
const shot = await sess.send('Page.captureScreenshot', { format: 'png' });
writeFileSync('extensions-devmode.png', Buffer.from(shot.data, 'base64'));
console.log('Screenshot saved');
sess.close();
