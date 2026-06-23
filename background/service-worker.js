import { setupScheduler, checkSingleTask, checkAllTasks } from './scheduler.js';
import {
  getTasks, saveTask, deleteTask, getChanges, markRead,
  markAllRead, getSettings, saveSettings, getUnreadCount,
  getNumericHistory,
} from './storage.js';
import { testFeishuWebhook } from './notifier.js';

setupScheduler();

// Test hook: expose internal functions for E2E testing via CDP
import { fetchPageContent } from './fetcher.js';
self.__maywatch_test__ = { checkAllTasks, getNumericHistory, getTasks, getChanges, fetchPageContent };

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'maywatch-monitor-element',
    title: '用 MayWatch 监控此元素',
    contexts: ['all'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'maywatch-monitor-element') return;
  if (!tab?.id) return;

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      return window.__maywatch_last_context_target || null;
    },
  });

  if (!results?.[0]?.result) return;

  const data = results[0].result;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.id) {
    chrome.tabs.sendMessage(tabs[0].id, {
      type: 'QUICK_ADD',
      data,
    }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PARSE_HTML') return false;
  handleMessage(message, sender).then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'CHECK_NOW': {
      if (message.taskId) {
        const tasks = await getTasks();
        const task = tasks.find(t => t.id === message.taskId);
        if (!task) return { error: '任务不存在' };
        const result = await checkSingleTask(task);
        return { type: 'CHECK_COMPLETE', results: [result] };
      }
      const results = await checkAllTasks();
      return { type: 'CHECK_COMPLETE', results };
    }

    case 'GET_CHANGES': {
      const changes = await getChanges();
      if (message.unreadOnly) {
        return { type: 'CHANGES_DATA', changes: changes.filter(c => !c.read) };
      }
      return { type: 'CHANGES_DATA', changes };
    }

    case 'MARK_READ':
      await markRead(message.changeId);
      return { success: true };

    case 'MARK_ALL_READ':
      await markAllRead();
      return { success: true };

    case 'GET_TASKS': {
      const tasks = await getTasks();
      return { type: 'TASKS_DATA', tasks };
    }

    case 'SAVE_TASK':
      await saveTask(message.task);
      return { success: true };

    case 'DELETE_TASK':
      await deleteTask(message.taskId);
      return { success: true };

    case 'GET_SETTINGS': {
      const settings = await getSettings();
      return { type: 'SETTINGS_DATA', settings };
    }

    case 'SAVE_SETTINGS':
      await saveSettings(message.settings);
      return { success: true };

    case 'GET_UNREAD_COUNT': {
      const count = await getUnreadCount();
      return { type: 'UNREAD_COUNT', count };
    }

    case 'GET_NUMERIC_HISTORY': {
      const history = await getNumericHistory(message.taskId);
      return { type: 'NUMERIC_HISTORY', history };
    }

    case 'GET_PENDING_QUICK_ADD': {
      const { pendingQuickAdd } = await chrome.storage.local.get('pendingQuickAdd');
      if (pendingQuickAdd) {
        await chrome.storage.local.remove('pendingQuickAdd');
      }
      return { type: 'PENDING_QUICK_ADD', data: pendingQuickAdd || null };
    }

    case 'TEST_FEISHU': {
      const result = await testFeishuWebhook(message.webhookUrl, message.secret);
      return { type: 'FEISHU_TEST_RESULT', result };
    }

    default:
      return undefined;
  }
}
