document.addEventListener("DOMContentLoaded", init);

const $ = (sel) => document.querySelector(sel);
const taskList = $("#taskList");
const modalOverlay = $("#modalOverlay");
const taskForm = $("#taskForm");
const globalToggle = $("#globalToggle");

let tasks = [];
let globalEnabled = true;

async function init() {
  await loadSettings();
  await loadFeishuSettings();
  await loadTasks();
  bindEvents();
  await checkPendingQuickAdd();
}

async function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

async function loadSettings() {
  const res = await sendMessage({ type: "GET_SETTINGS" });
  if (res?.settings) {
    globalEnabled = res.settings.globalEnabled !== false;
    globalToggle.checked = globalEnabled;
  }
}

async function loadTasks() {
  const res = await sendMessage({ type: "GET_TASKS" });
  tasks = res?.tasks || [];
  renderTasks();
}

function renderTasks() {
  if (tasks.length === 0) {
    taskList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">👀</div>
        <div>暂无监控任务</div>
      </div>`;
    return;
  }

  taskList.innerHTML = tasks
    .map(
      (task) => `
    <div class="task-card ${task.enabled ? "" : "disabled"}" data-id="${task.id}">
      <div class="task-header">
        <span class="task-name">${escapeHtml(task.name)}</span>
      </div>
      <div class="task-url" title="${escapeHtml(task.url)}">${escapeHtml(truncateUrl(task.url))}</div>
      <div class="task-meta">
        <span class="task-interval">${formatInterval(task.interval)}</span>
        <div class="task-actions">
          <label class="toggle">
            <input type="checkbox" ${task.enabled ? "checked" : ""} data-action="toggle" data-id="${task.id}">
            <span class="toggle-slider"></span>
          </label>
          <button class="icon-btn" data-action="edit" data-id="${task.id}" title="编辑">✏️</button>
          <button class="icon-btn delete" data-action="delete" data-id="${task.id}" title="删除">🗑️</button>
        </div>
      </div>
    </div>`
    )
    .join("");
}

function truncateUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname + u.search;
    const maxLen = 40;
    const display = u.host + path;
    return display.length > maxLen ? display.slice(0, maxLen) + "…" : display;
  } catch {
    return url.length > 40 ? url.slice(0, 40) + "…" : url;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatInterval(seconds) {
  if (seconds < 60) return `${seconds}秒`;
  if (seconds % 60 === 0) return `${seconds / 60}分钟`;
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

function bindEvents() {
  $("#addTaskBtn").addEventListener("click", () => openModal());
  $("#cancelBtn").addEventListener("click", () => closeModal());
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  taskForm.addEventListener("submit", handleFormSubmit);

  taskList.addEventListener("click", handleTaskAction);
  taskList.addEventListener("change", handleTaskAction);

  $("#checkAllBtn").addEventListener("click", handleCheckAll);

  globalToggle.addEventListener("change", handleGlobalToggle);

  $("#taskNumericEnabled").addEventListener("change", updateNumericFieldsVisibility);
  $("#taskNumericMode").addEventListener("change", updateNumericModeFields);

  $("#feishuToggleHeader").addEventListener("click", toggleFeishuSection);
  $("#feishuEnabled").addEventListener("change", saveFeishuSettings);
  $("#feishuWebhook").addEventListener("change", saveFeishuSettings);
  $("#feishuSecret").addEventListener("change", saveFeishuSettings);
  $("#testFeishuBtn").addEventListener("click", testFeishu);
}

function openModal(task = null) {
  $("#runtimeResetHint").classList.toggle("show", Boolean(task));
  if (task) {
    $("#modalTitle").textContent = "编辑监控";
    $("#taskId").value = task.id;
    $("#taskUrl").value = task.url;
    $("#taskName").value = task.name;
    $("#taskSelector").value = task.selector || "";
    $("#taskSelectorType").value = task.selectorType || "css";
    if (task.interval >= 60 && task.interval % 60 === 0) {
      $("#taskInterval").value = task.interval / 60;
      $("#taskIntervalUnit").value = "m";
    } else {
      $("#taskInterval").value = task.interval;
      $("#taskIntervalUnit").value = "s";
    }
    const numericOn = task.numericMode && task.numericMode !== "off";
    $("#taskNumericEnabled").checked = numericOn;
    $("#taskNumericMode").value = numericOn ? task.numericMode : "auto";
    $("#taskNumericTemplate").value = task.numericTemplate || "integer";
    $("#taskNumericRegex").value = task.numericRegex || "";
  } else {
    $("#modalTitle").textContent = "添加监控";
    taskForm.reset();
    $("#taskId").value = "";
    $("#taskInterval").value = "5";
    $("#taskIntervalUnit").value = "s";
    $("#taskSelectorType").value = "css";
    $("#taskNumericEnabled").checked = false;
    $("#taskNumericMode").value = "auto";
    $("#taskNumericTemplate").value = "integer";
    $("#taskNumericRegex").value = "";
  }
  updateNumericFieldsVisibility();
  updateNumericModeFields();
  modalOverlay.classList.add("active");
}

function closeModal() {
  modalOverlay.classList.remove("active");
  $("#runtimeResetHint").classList.remove("show");
  taskForm.reset();
  $("#taskId").value = "";
}

async function handleFormSubmit(e) {
  e.preventDefault();

  const id = $("#taskId").value || crypto.randomUUID();
  const existing = tasks.find((t) => t.id === id);

  const rawInterval = Number($("#taskInterval").value);
  const unit = $("#taskIntervalUnit").value;
  const intervalSeconds = unit === "m" ? rawInterval * 60 : rawInterval;

  const task = {
    id,
    url: $("#taskUrl").value.trim(),
    name: $("#taskName").value.trim(),
    selector: $("#taskSelector").value.trim() || null,
    selectorType: $("#taskSelectorType").value,
    interval: Math.max(1, Math.floor(intervalSeconds)),
    numericMode: $("#taskNumericEnabled").checked ? $("#taskNumericMode").value : "off",
    numericTemplate: $("#taskNumericTemplate").value,
    numericRegex: $("#taskNumericRegex").value.trim(),
    enabled: existing ? existing.enabled : true,
    createdAt: existing ? existing.createdAt : Date.now(),
    lastCheckedAt: existing ? existing.lastCheckedAt : 0,
  };

  await sendMessage({ type: "SAVE_TASK", task });
  closeModal();
  await loadTasks();
}

async function handleTaskAction(e) {
  const target = e.target.closest("[data-action]");
  if (!target) return;

  const action = target.dataset.action;
  const id = target.dataset.id;
  const task = tasks.find((t) => t.id === id);
  if (!task) return;

  if (action === "toggle") {
    task.enabled = target.checked;
    await sendMessage({ type: "SAVE_TASK", task });
    await loadTasks();
  } else if (action === "edit") {
    openModal(task);
  } else if (action === "delete") {
    await sendMessage({ type: "DELETE_TASK", taskId: id });
    await loadTasks();
  }
}

async function handleCheckAll() {
  const btn = $("#checkAllBtn");
  btn.disabled = true;
  btn.textContent = "检查中…";
  try {
    await sendMessage({ type: "CHECK_NOW" });
  } finally {
    btn.disabled = false;
    btn.textContent = "检查全部";
    await loadTasks();
  }
}

async function handleGlobalToggle() {
  globalEnabled = globalToggle.checked;
  await sendMessage({
    type: "SAVE_SETTINGS",
    settings: { globalEnabled },
  });
}

async function checkPendingQuickAdd() {
  const res = await sendMessage({ type: "GET_PENDING_QUICK_ADD" });
  if (!res?.data) return;

  const data = res.data;
  openModal();
  $("#taskUrl").value = data.url || "";
  $("#taskName").value = data.title || "";
  $("#taskSelectorType").value = "xpath";
  $("#taskSelector").value = data.xpath || "";
  $("#taskInterval").value = "5";
  $("#taskIntervalUnit").value = "s";
}

function updateNumericFieldsVisibility() {
  const enabled = $("#taskNumericEnabled").checked;
  $("#numericFields").style.display = enabled ? "block" : "none";
}

function updateNumericModeFields() {
  const mode = $("#taskNumericMode").value;
  $("#numericTemplateGroup").style.display = mode === "template" ? "block" : "none";
  $("#numericRegexGroup").style.display = mode === "regex" ? "block" : "none";
}

async function loadFeishuSettings() {
  const res = await sendMessage({ type: "GET_SETTINGS" });
  if (res?.settings) {
    $("#feishuWebhook").value = res.settings.feishuWebhook || "";
    $("#feishuSecret").value = res.settings.feishuSecret || "";
    $("#feishuEnabled").checked = res.settings.feishuEnabled === true;
  }
}

async function saveFeishuSettings() {
  await sendMessage({
    type: "SAVE_SETTINGS",
    settings: {
      globalEnabled,
      feishuWebhook: $("#feishuWebhook").value.trim(),
      feishuSecret: $("#feishuSecret").value.trim(),
      feishuEnabled: $("#feishuEnabled").checked,
    },
  });
}

function toggleFeishuSection() {
  const section = $("#feishuSection");
  section.classList.toggle("open");
}

async function testFeishu() {
  const btn = $("#testFeishuBtn");
  btn.disabled = true;
  btn.textContent = "发送中…";
  try {
    const webhookUrl = $("#feishuWebhook").value.trim();
    const secret = $("#feishuSecret").value.trim();
    if (!webhookUrl) {
      btn.textContent = "请填写 Webhook";
      return;
    }
    const res = await sendMessage({ type: "TEST_FEISHU", webhookUrl, secret });
    const ok = res?.result?.code === 0 || res?.result?.StatusCode === 0;
    btn.textContent = ok ? "成功 ✓" : "失败 ✗";
  } catch {
    btn.textContent = "失败 ✗";
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = "测试";
    }, 2000);
  }
}
