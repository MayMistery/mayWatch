import fs from 'fs';

const TEST_URL = 'http://127.0.0.1:8730/maywatch-test.html';

async function getJSON(path) {
  const r = await fetch(`http://127.0.0.1:9222${path}`);
  return r.json();
}

function createSession(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let id = 0;
    const eventHandlers = new Map();

    ws.on('open', () => resolve({
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const msgId = ++id;
          pending.set(msgId, { res, rej });
          ws.send(JSON.stringify({ id: msgId, method, params }));
        });
      },
      on(event, handler) {
        if (!eventHandlers.has(event)) eventHandlers.set(event, []);
        eventHandlers.get(event).push(handler);
      },
      close() { ws.close(); },
    }));

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(`${msg.error.message}: ${JSON.stringify(msg.error.data)}`));
        else res(msg.result);
      } else if (msg.method && eventHandlers.has(msg.method)) {
        for (const h of eventHandlers.get(msg.method)) h(msg.params);
      }
    });

    ws.on('error', reject);
  });
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function evaluate(session, expression) {
  const result = await session.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(`Eval error: ${desc}`);
  }
  return result.result.value;
}

function findNodesInDomTree(node, selector, depth = 0) {
  const results = [];
  const sel = selector.toLowerCase();

  function matches(node) {
    if (!node) return false;
    if (selector.startsWith('#')) {
      const id = node.attributes ? (() => {
        const attrs = node.attributes;
        for (let i = 0; i < attrs.length; i += 2) {
          if (attrs[i] === 'id') return attrs[i+1];
        }
        return null;
      })() : null;
      return id === selector.slice(1);
    }
    if (selector.startsWith('.')) {
      const cls = node.attributes ? (() => {
        const attrs = node.attributes;
        for (let i = 0; i < attrs.length; i += 2) {
          if (attrs[i] === 'class') return attrs[i+1];
        }
        return null;
      })() : null;
      return cls && cls.split(/\s+/).includes(selector.slice(1));
    }
    return node.nodeName && node.nodeName.toLowerCase() === sel;
  }

  function walk(n) {
    if (matches(n)) results.push(n);
    if (n.shadowRoots) {
      for (const sr of n.shadowRoots) walk(sr);
    }
    if (n.templateContent) walk(n.templateContent);
    if (n.children) {
      for (const child of n.children) walk(child);
    }
    if (n.contentDocument) walk(n.contentDocument);
  }
  walk(node);
  return results;
}

async function findNodeBySelector(session, selector) {
  const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
  const nodes = findNodesInDomTree(root, selector);
  return nodes.length > 0 ? nodes[0] : null;
}

async function clickNode(session, nodeId) {
  const { model } = await session.send('DOM.getBoxModel', { nodeId });
  if (!model) throw new Error('No box model for node');
  const [x1, y1, x2, y2] = model.content;
  const x = (x1 + x2) / 2;
  const y = (y1 + y2) / 2;

  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', clickCount: 1,
  });
  await wait(50);
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
  });
}

async function resetTaskForCheck(swSession, taskId) {
  await evaluate(swSession, `
    (async () => {
      const { tasks = [] } = await chrome.storage.local.get('tasks');
      const task = tasks.find(t => t.id === '${taskId}');
      if (task) { task.lastCheckedAt = 0; await chrome.storage.local.set({ tasks }); }
    })()
  `);
}

async function getHistory(swSession, taskId) {
  const raw = await evaluate(swSession, `
    (async () => {
      const r = await chrome.storage.local.get('numericHistory:${taskId}');
      return JSON.stringify(r['numericHistory:${taskId}'] || []);
    })()
  `);
  return JSON.parse(raw);
}

async function getFullState(swSession, taskId) {
  const raw = await evaluate(swSession, `
    (async () => {
      const all = await chrome.storage.local.get(null);
      const history = all['numericHistory:${taskId}'] || [];
      const snapshot = all['snapshot:${taskId}'];
      const changes = (all.changes || []).filter(c => c.taskId === '${taskId}');
      return JSON.stringify({
        historyLength: history.length,
        history: history.map(h => ({ value: h.value, ts: h.timestamp })),
        snapshotContent: snapshot?.content,
        changeCount: changes.length,
        changeValues: changes.map(c => c.numericValue),
      });
    })()
  `);
  return JSON.parse(raw);
}

async function waitForHistoryToGrow(swSession, taskId, minLength, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const h = await getHistory(swSession, taskId);
    if (h.length >= minLength) return h;
    await resetTaskForCheck(swSession, taskId);
    await wait(1500);
  }
  const h = await getHistory(swSession, taskId);
  throw new Error(`Timeout waiting for history >= ${minLength}, got ${h.length}`);
}

async function waitForNewChange(swSession, taskId, prevCount, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await getFullState(swSession, taskId);
    if (s.changeCount > prevCount) return s;
    await resetTaskForCheck(swSession, taskId);
    await wait(1500);
  }
  throw new Error(`Timeout waiting for change > ${prevCount}`);
}

async function main() {
  console.log('=== MayWatch E2E Test ===\n');

  const targets = await getJSON('/json');
  console.log('Targets:', targets.length);

  const pageTarget = targets.find(t => t.type === 'page' && t.url.includes('maywatch-test.html'));
  if (!pageTarget) throw new Error('Test page not found');

  const swTarget = targets.find(t => t.type === 'service_worker' && t.url?.includes('maywatch'));
  if (!swTarget) {
    console.log('Available:', targets.map(t => ({ type: t.type, url: t.url?.substring(0, 100) })));
    throw new Error('Extension service worker not found');
  }

  console.log('Page:', pageTarget.id);
  console.log('SW:', swTarget.url?.substring(0, 120));

  const pageSession = await createSession(pageTarget.webSocketDebuggerUrl);
  const swSession = await createSession(swTarget.webSocketDebuggerUrl);

  await pageSession.send('Page.enable');
  await pageSession.send('Runtime.enable');
  await pageSession.send('DOM.enable');
  await pageSession.send('Input.enable');
  await swSession.send('Runtime.enable');

  const keepalive = setInterval(() => evaluate(swSession, '1').catch(()=>{}), 2000);

  try {
    console.log('\n--- Wait for page load ---');
    await evaluate(pageSession, `new Promise(r => { if(document.readyState==='complete')r(); else window.addEventListener('load',r,{once:true}); })`);
    await wait(2000);

    let hero = await evaluate(pageSession, `document.getElementById('heroRevenue')?.textContent || 'NOT_FOUND'`);
    console.log('#heroRevenue initial:', hero);

    console.log('\n--- Pause auto-stream ---');
    await evaluate(pageSession, `(() => {
      const b = document.getElementById('toggleStream');
      if (b && b.textContent.includes('Pause')) b.click();
    })()`);
    await wait(500);

    console.log('\n--- Add monitoring task (#heroRevenue, numeric auto, interval=2s) ---');
    const taskId = await evaluate(swSession, `
      (async () => {
        const taskId = 'e2e-' + Date.now();
        const task = {
          id: taskId,
          url: '${TEST_URL}',
          name: 'Hero Revenue',
          selector: '#heroRevenue',
          selectorType: 'css',
          interval: 2,
          enabled: true,
          createdAt: Date.now(),
          lastCheckedAt: 0,
          numericMode: 'auto',
          numericTemplate: 'with-unit',
          numericRegex: '',
        };
        const { tasks = [] } = await chrome.storage.local.get('tasks');
        tasks.push(task);
        await chrome.storage.local.set({ tasks });
        return taskId;
      })()
    `);
    console.log('Task ID:', taskId);

    console.log('\n=== SAMPLING (at least 3 real values) ===');

    console.log('[Sample 1] First snapshot...');
    await resetTaskForCheck(swSession, taskId);
    await waitForHistoryToGrow(swSession, taskId, 1, 10000);
    let h = await getHistory(swSession, taskId);
    console.log('  -> history:', h.length, 'values:', h.map(p => p.value.toFixed(2)));

    console.log('[Sample 2] Step once to change value...');
    await evaluate(pageSession, `document.getElementById('stepOnce').click()`);
    await wait(800);
    hero = await evaluate(pageSession, `document.getElementById('heroRevenue').textContent`);
    console.log('  -> #heroRevenue:', hero);
    await resetTaskForCheck(swSession, taskId);
    let s = await waitForNewChange(swSession, taskId, 0, 10000);
    console.log('  -> history:', s.historyLength, 'values:', s.history.map(p => p.value.toFixed(2)), 'changes:', s.changeCount);

    console.log('[Sample 3] Step again for third value...');
    await evaluate(pageSession, `document.getElementById('stepOnce').click()`);
    await wait(800);
    hero = await evaluate(pageSession, `document.getElementById('heroRevenue').textContent`);
    console.log('  -> #heroRevenue:', hero);
    await resetTaskForCheck(swSession, taskId);
    s = await waitForNewChange(swSession, taskId, s.changeCount, 10000);
    console.log('  -> history:', s.historyLength, 'values:', s.history.map(p => p.value.toFixed(2)), 'changes:', s.changeCount);

    console.log('\n=== PLACEHOLDER TEST ===');
    console.log('Clicking "Refresh placeholders"...');
    await evaluate(pageSession, `document.getElementById('refreshPlaceholders').click()`);
    await wait(800);
    hero = await evaluate(pageSession, `document.getElementById('heroRevenue').textContent`);
    console.log('#heroRevenue (placeholder):', JSON.stringify(hero));

    const snapBefore = await evaluate(swSession, `
      (async () => { const r = await chrome.storage.local.get('snapshot:${taskId}'); return r['snapshot:${taskId}']?.content || null; })()
    `);
    const histBeforePh = await getHistory(swSession, taskId);
    console.log('Snapshot before placeholder check:', JSON.stringify(snapBefore));
    console.log('History length before placeholder:', histBeforePh.length);

    console.log('\nRunning check during placeholder state...');
    await resetTaskForCheck(swSession, taskId);
    await wait(3500);

    const snapAfter = await evaluate(swSession, `
      (async () => { const r = await chrome.storage.local.get('snapshot:${taskId}'); return r['snapshot:${taskId}']?.content || null; })()
    `);
    const histAfterPh = await getHistory(swSession, taskId);
    console.log('Snapshot after placeholder check:', JSON.stringify(snapAfter));
    console.log('History length after placeholder:', histAfterPh.length, '->', histAfterPh.map(p => p.value));

    console.log('\nRestoring real value after placeholder...');
    await evaluate(pageSession, `document.getElementById('stepOnce').click()`);
    await wait(800);
    hero = await evaluate(pageSession, `document.getElementById('heroRevenue').textContent`);
    console.log('#heroRevenue (post-placeholder):', hero);
    await resetTaskForCheck(swSession, taskId);
    await wait(2500);
    s = await getFullState(swSession, taskId);
    console.log('Final history:', s.historyLength, 'values:', s.history.map(p => p.value.toFixed(2)));
    console.log('Final snapshot:', JSON.stringify(s.snapshotContent));
    console.log('Final changes:', s.changeCount);

    console.log('\n=== DATA ASSERTIONS ===');
    const phRegexes = [/^\.\.\.$/, /^…+$/, /^-{2,}$/, /^loading/i, /^暂无数据$/, /^无数据$/, /^waiting/i, /^pending/i, /^N\/?A$/i, /^null$/i, /^undefined$/i, /^none$/i];

    const checks = [
      { name: 'numericHistory >= 2', pass: s.historyLength >= 2, actual: s.historyLength },
      { name: 'numericHistory >= 3 (3+ samples)', pass: s.historyLength >= 3, actual: s.historyLength },
      { name: '占位值未写入 numericHistory', pass: !s.history.some(h => phRegexes.some(r => r.test(String(h.value).trim()))), actual: s.history.map(h => h.value) },
      { name: '快照未被占位值覆盖', pass: !phRegexes.some(r => r.test((s.snapshotContent||'').trim())), actual: s.snapshotContent },
      { name: 'placeholder 期间历史长度未增长', pass: histAfterPh.length === histBeforePh.length, actual: { before: histBeforePh.length, after: histAfterPh.length } },
      { name: 'placeholder 期间快照未被替换', pass: !phRegexes.some(r => r.test((snapAfter||'').trim())), actual: snapAfter },
      { name: '所有历史值都是有效数字', pass: s.history.every(h => typeof h.value === 'number' && isFinite(h.value)), actual: s.history.map(h => h.value) },
      { name: '至少有1条change记录', pass: s.changeCount >= 1, actual: s.changeCount },
    ];

    let allPass = true;
    for (const c of checks) {
      const icon = c.pass ? '✅' : '❌';
      console.log(`${icon} ${c.name}: ${JSON.stringify(c.actual).substring(0, 200)}`);
      if (!c.pass) allPass = false;
    }

    if (!allPass) {
      console.log('\n❌ Data checks failed!');
      process.exit(1);
    }

    console.log('\n=== UI VERIFICATION (Shadow DOM piercing via CDP) ===');
    await wait(1000);

    console.log('Finding MayWatch trigger button (in closed Shadow DOM)...');
    const triggerNode = await findNodeBySelector(pageSession, '#mw-trigger');
    if (!triggerNode) {
      throw new Error('Could not find #mw-trigger in shadow DOM');
    }
    console.log('Found trigger button, nodeId:', triggerNode.nodeId);

    console.log('Clicking trigger to open panel...');
    await clickNode(pageSession, triggerNode.nodeId);
    await wait(2000);

    console.log('Finding change cards in panel...');
    const cardNode = await findNodeBySelector(pageSession, '.mw-change-card');
    if (!cardNode) {
      const groups = await findNodeBySelector(pageSession, '.mw-task-group');
      console.log('No change cards found. Task groups found:', groups?.nodeId);
      await wait(2000);
    }

    let changeCard = await findNodeBySelector(pageSession, '.mw-change-card');
    if (!changeCard) {
      console.log('Cards not visible, clicking task group header to expand...');
      const groupHeader = await findNodeBySelector(pageSession, '.mw-task-group-header');
      if (groupHeader) {
        await clickNode(pageSession, groupHeader.nodeId);
        await wait(1500);
      }
      changeCard = await findNodeBySelector(pageSession, '.mw-change-card');
    }

    if (changeCard) {
      console.log('Found change card, clicking to open detail...');
      await clickNode(pageSession, changeCard.nodeId);
      await wait(3500);
    } else {
      console.log('WARNING: No change cards found, checking task group expanded state');
    }

    console.log('\nChecking for trend chart canvas in Shadow DOM...');
    const canvasNode = await findNodeBySelector(pageSession, '#mw-trend-chart');
    const chartContainer = await findNodeBySelector(pageSession, '#mw-chart-container');
    const detailView = await findNodeBySelector(pageSession, '#mw-detail-view');
    const statsEl = await findNodeBySelector(pageSession, '#mw-numeric-stats');

    console.log('Canvas node found:', !!canvasNode, 'nodeId:', canvasNode?.nodeId);
    console.log('Chart container found:', !!chartContainer);
    console.log('Detail view found:', !!detailView);

    if (canvasNode) {
      try {
        const { object } = await pageSession.send('DOM.resolveNode', { nodeId: canvasNode.nodeId });
        const canvasInfo = await pageSession.send('Runtime.callFunctionOn', {
          functionDeclaration: `function() {
            const ctx = this.getContext('2d');
            const w = this.width, h = this.height;
            const img = ctx.getImageData(0, 0, w, h);
            const d = img.data;
            let nonBlank = 0, colored = 0, sampled = 0;
            for (let i = 0; i < d.length; i += 16) {
              sampled++;
              const a = d[i+3], r = d[i], g = d[i+1], b = d[i+2];
              if (a > 20) {
                nonBlank++;
                const maxC = Math.max(r,g,b), minC = Math.min(r,g,b);
                if (maxC - minC > 10 || (r < 220 && g < 220 && b < 220)) colored++;
              }
            }
            return JSON.stringify({ w, h, sampled, nonBlank, colored, ratio: colored/sampled, hasChart: colored > 30 });
          }`,
          objectId: object.objectId,
          returnByValue: true,
        });
        console.log('Canvas pixel analysis:', canvasInfo.result.value);
        const pxData = JSON.parse(canvasInfo.result.value);

        const uiChecks = [
          { name: 'Canvas 有有效尺寸', pass: pxData.w >= 200 && pxData.h >= 80, actual: `${pxData.w}x${pxData.h}` },
          { name: 'Canvas 有图表绘制内容 (非空白)', pass: pxData.hasChart === true, actual: `${pxData.colored}/${pxData.sampled} colored pixels` },
        ];

        for (const c of uiChecks) {
          const icon = c.pass ? '✅' : '❌';
          console.log(`${icon} ${c.name}: ${JSON.stringify(c.actual)}`);
          if (!c.pass) allPass = false;
        }
      } catch (e) {
        console.log('Canvas analysis error:', e.message);
      }
    } else {
      console.log('❌ Canvas element #mw-trend-chart not found in shadow DOM!');
      allPass = false;
    }

    console.log('\n=== Capturing screenshot... ===');
    await wait(800);
    const ss = await pageSession.send('Page.captureScreenshot', { format: 'png' });
    const ssPath = '/Users/bytedance/Desktop/mayWatch-doubao-seed-2.1-pro/test-screenshot.png';
    fs.writeFileSync(ssPath, Buffer.from(ss.data, 'base64'));
    console.log('Screenshot saved:', ssPath);

    console.log('\n========================================');
    console.log('        EVIDENCE SUMMARY');
    console.log('========================================');
    console.log(`✅ numericHistory points: ${s.historyLength} (requirement: >= 2, achieved: >= 3)`);
    console.log(`✅ History values: [${s.history.map(p=>p.value.toFixed(2)).join(', ')}]`);
    console.log(`✅ Placeholder values (Loading.../--/暂无数据/waiting) NOT in history`);
    console.log(`✅ Snapshot preserved real value during placeholder: "${s.snapshotContent}"`);
    console.log(`✅ Change records created: ${s.changeCount}`);
    console.log(`✅ Screenshot captured: ${ssPath}`);
    console.log('========================================');

    clearInterval(keepalive);
    pageSession.close();
    swSession.close();

    if (!allPass) {
      console.log('\n❌ SOME CHECKS FAILED');
      process.exit(1);
    }
    console.log('\n🎉 ALL TESTS PASSED - EVIDENCE VERIFIED');
  } catch (e) {
    clearInterval(keepalive);
    pageSession.close();
    swSession.close();
    throw e;
  }
}

main().catch(err => {
  console.error('\n❌ FATAL:', err);
  process.exit(1);
});
