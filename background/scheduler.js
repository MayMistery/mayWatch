import { getTasks, saveTask, getSnapshot, saveSnapshot, addChange, getSettings, addNumericPoint, getNumericHistory } from './storage.js';
import { fetchPageContent } from './fetcher.js';
import { computeDiff, createChangeRecord, isPlaceholderContent, extractNumericValue } from './differ.js';
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

  task.lastCheckedAt = now;
  await saveTask(task);

  if (isPlaceholderContent(content)) {
    if (!snapshot) {
      return { taskId: task.id, status: 'placeholder_waiting' };
    }
    return { taskId: task.id, status: 'placeholder_skipped' };
  }

  if (!snapshot) {
    await saveSnapshot({ taskId: task.id, content, timestamp: now, url: task.url });
    const numericResult = extractNumericValue(content, task);
    if (numericResult.isNumeric) {
      await addNumericPoint(task.id, numericResult.numericValue, now);
    }
    return { taskId: task.id, status: 'first_snapshot' };
  }

  const diffResult = computeDiff(snapshot.content, content);

  await saveSnapshot({ taskId: task.id, content, timestamp: now, url: task.url });

  if (!diffResult) {
    const numericResult = extractNumericValue(content, task);
    if (numericResult.isNumeric) {
      const history = await getNumericHistory(task.id);
      if (history.length === 0) {
        await addNumericPoint(task.id, numericResult.numericValue, now);
      }
    }
    return { taskId: task.id, status: 'no_change' };
  }

  const changeRecord = createChangeRecord(task, snapshot.content, content, diffResult);
  await addChange(changeRecord);

  if (changeRecord.isNumeric) {
    await addNumericPoint(task.id, changeRecord.numericValue, changeRecord.detectedAt);
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
