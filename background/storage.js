const DEFAULT_SETTINGS = {
  globalEnabled: true,
  maxChanges: 100,
  defaultInterval: 5,
  feishuEnabled: false,
  feishuWebhook: '',
  feishuSecret: '',
};

const TASK_RUNTIME_SEMANTIC_FIELDS = [
  'url',
  'selector',
  'selectorType',
  'numericMode',
  'numericTemplate',
  'numericRegex',
];

export function hasTaskRuntimeSemanticChange(previous, next) {
  if (!previous) return false;
  return TASK_RUNTIME_SEMANTIC_FIELDS.some(
    field => (previous[field] ?? null) !== (next[field] ?? null)
  );
}

export async function getTasks() {
  const { tasks = [] } = await chrome.storage.local.get('tasks');
  return tasks;
}

export async function saveTask(task) {
  const tasks = await getTasks();
  const idx = tasks.findIndex(t => t.id === task.id);
  if (idx >= 0) {
    tasks[idx] = task;
  } else {
    tasks.push(task);
  }
  await chrome.storage.local.set({ tasks });
}

export async function deleteTask(taskId) {
  const tasks = await getTasks();
  const filtered = tasks.filter(t => t.id !== taskId);
  await chrome.storage.local.set({ tasks: filtered });
  await resetTaskRuntimeData(taskId);
}

export async function getSnapshot(taskId) {
  const key = `snapshot:${taskId}`;
  const result = await chrome.storage.local.get(key);
  return result[key] || null;
}

export async function saveSnapshot(snapshot) {
  const key = `snapshot:${snapshot.taskId}`;
  await chrome.storage.local.set({ [key]: snapshot });
}

export async function getChanges() {
  const { changes = [] } = await chrome.storage.local.get('changes');
  return changes;
}

export async function addChange(change) {
  const settings = await getSettings();
  const changes = await getChanges();
  changes.unshift(change);
  if (changes.length > settings.maxChanges) {
    changes.length = settings.maxChanges;
  }
  await chrome.storage.local.set({ changes });
}

export async function markRead(changeId) {
  const changes = await getChanges();
  const target = changes.find(c => c.id === changeId);
  if (target) {
    target.read = true;
    await chrome.storage.local.set({ changes });
  }
}

export async function markAllRead() {
  const changes = await getChanges();
  for (const c of changes) {
    c.read = true;
  }
  await chrome.storage.local.set({ changes });
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

export async function saveSettings(settings) {
  const current = await getSettings();
  await chrome.storage.local.set({ settings: { ...current, ...settings } });
}

export async function getUnreadCount() {
  const changes = await getChanges();
  return changes.filter(c => !c.read).length;
}

export async function getNumericHistory(taskId) {
  const key = `numericHistory:${taskId}`;
  const result = await chrome.storage.local.get(key);
  const history = result[key];
  if (!Array.isArray(history)) return [];
  return history.filter(point =>
    point && Number.isFinite(point.value) && Number.isFinite(point.timestamp)
  );
}

export async function addNumericPointIfChanged(taskId, value, timestamp) {
  if (!Number.isFinite(value) || !Number.isFinite(timestamp)) {
    throw new TypeError('Numeric history points require finite value and timestamp');
  }

  const key = `numericHistory:${taskId}`;
  const history = await getNumericHistory(taskId);
  const last = history[history.length - 1];
  if (last && Object.is(last.value, value)) {
    return { added: false, historyLength: history.length };
  }

  history.push({ value, timestamp });
  if (history.length > 100) {
    history.splice(0, history.length - 100);
  }
  await chrome.storage.local.set({ [key]: history });
  return { added: true, historyLength: history.length };
}

export async function clearNumericHistory(taskId) {
  await chrome.storage.local.remove(`numericHistory:${taskId}`);
}

export async function resetTaskRuntimeData(taskId) {
  await chrome.storage.local.remove([
    `snapshot:${taskId}`,
    `numericHistory:${taskId}`,
  ]);
}
