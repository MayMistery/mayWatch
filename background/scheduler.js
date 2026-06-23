import { getTasks, saveTask, getSnapshot, saveSnapshot, addChange, getSettings, addNumericPoint } from './storage.js';
import { fetchPageContent } from './fetcher.js';
import { decideCheck, createChangeRecord } from './differ.js';
import { sendFeishuNotification } from './notifier.js';

const MAX_CONTENT_SIZE = 500 * 1024;
const TICK_INTERVAL_MS = 1000;
let tickTimer = null;
let checking = false;

export function setupScheduler() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    if (!checking) {
      checking = true;
      checkDueTasks().finally(() => { checking = false; });
    }
  }, TICK_INTERVAL_MS);
}

async function checkDueTasks() {
  const settings = await getSettings();
  if (!settings.globalEnabled) return;

  const tasks = await getTasks();
  const now = Date.now();
  const dueTasks = tasks.filter(t =>
    t.enabled && (now - t.lastCheckedAt >= t.interval * 1000)
  );

  if (dueTasks.length === 0) return;

  await Promise.allSettled(
    dueTasks.map(task => checkSingleTask(task))
  );
}

export async function checkSingleTask(task) {
  let content;
  try {
    content = await fetchPageContent(task.url, task.selector, task.selectorType);
  } catch (err) {
    console.warn(`[MayWatch] 获取失败 ${task.name}:`, err.message);
    throw err;
  }

  if (content.length > MAX_CONTENT_SIZE) {
    content = content.slice(0, MAX_CONTENT_SIZE);
  }

  const snapshot = await getSnapshot(task.id);
  const now = Date.now();

  const decision = decideCheck(task, snapshot, content);

  // A transient placeholder (e.g. "—"/"Loading…") while the page re-fetches:
  // keep the last good snapshot and skip without touching lastCheckedAt's diff.
  if (decision.action === 'skip') {
    task.lastCheckedAt = now;
    await saveTask(task);
    return { taskId: task.id, status: 'skipped', reason: decision.reason };
  }

  task.lastCheckedAt = now;
  await saveTask(task);

  await saveSnapshot({ taskId: task.id, content: decision.content, timestamp: now, url: task.url });

  if (decision.action === 'first_snapshot') {
    if (decision.numericPoint != null) {
      await addNumericPoint(task.id, decision.numericPoint, now);
    }
    return { taskId: task.id, status: 'first_snapshot' };
  }

  if (decision.action === 'no_change') {
    return { taskId: task.id, status: 'no_change' };
  }

  const changeRecord = createChangeRecord(
    task,
    snapshot.content,
    decision.content,
    decision.diffResult,
    { isNumeric: decision.isNumeric, numericValue: decision.numericValue },
  );
  await addChange(changeRecord);

  if (decision.numericPoint != null) {
    await addNumericPoint(task.id, decision.numericPoint, changeRecord.detectedAt);
  }

  broadcastChange(changeRecord);

  const settings = await getSettings();
  if (settings.feishuEnabled && settings.feishuWebhook) {
    sendFeishuNotification(settings.feishuWebhook, settings.feishuSecret, changeRecord).catch(() => {});
  }

  return { taskId: task.id, status: 'changed', change: changeRecord };
}

export async function checkAllTasks() {
  const settings = await getSettings();
  if (!settings.globalEnabled) return [];

  const tasks = await getTasks();
  const enabledTasks = tasks.filter(t => t.enabled);
  const results = await Promise.allSettled(
    enabledTasks.map(task => checkSingleTask(task))
  );
  return results.map((r, i) => ({
    taskId: enabledTasks[i].id,
    ...(r.status === 'fulfilled' ? r.value : { status: 'error', error: r.reason?.message }),
  }));
}

function broadcastChange(change) {
  chrome.runtime.sendMessage({
    type: 'CHANGE_DETECTED',
    change,
  }).catch(() => {});

  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'CHANGE_DETECTED',
          change,
        }).catch(() => {});
      }
    }
  });
}
