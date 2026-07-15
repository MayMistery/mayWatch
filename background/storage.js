const DEFAULT_SETTINGS = {
  globalEnabled: true,
  maxChanges: 100,
  defaultInterval: 5,
  feishuEnabled: false,
  feishuWebhook: '',
  feishuSecret: '',
};

export async function getTasks() {
  const { tasks = [] } = await chrome.storage.local.get('tasks');
  return tasks;
}

export async function saveTask(task) {
  const tasks = await getTasks();
  const idx = tasks.findIndex(t => t.id === task.id);
  if (idx >= 0) {
    const previous = tasks[idx];
    const targetChanged = ['url', 'selector', 'selectorType']
      .some(field => previous[field] !== task[field]);
    const numericConfigChanged = ['numericMode', 'numericTemplate', 'numericRegex']
      .some(field => previous[field] !== task[field]);

    if (targetChanged || numericConfigChanged) {
      await chrome.storage.local.remove([
        `snapshot:${task.id}`,
        `numericHistory:${task.id}`,
      ]);
    }
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
  await chrome.storage.local.remove([
    `snapshot:${taskId}`,
    `numericHistory:${taskId}`,
  ]);
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
  return result[key] || [];
}

export async function addNumericPoint(taskId, value, timestamp) {
  const key = `numericHistory:${taskId}`;
  const history = await getNumericHistory(taskId);
  history.push({ value, timestamp });
  if (history.length > 100) {
    history.splice(0, history.length - 100);
  }
  await chrome.storage.local.set({ [key]: history });
}
