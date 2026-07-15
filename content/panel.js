let Chart;

export class Panel {
  constructor(shadowRoot) {
    this.root = shadowRoot;
    this.changes = [];
    this.tasks = [];
    this.currentChange = null;
    this.currentTab = 'summary';
    this.viewMode = 'tasks';
    this.expandedTasks = new Set();
    this.trendChart = null;
    this.bindEvents();
    this.loadChanges();
  }

  bindEvents() {
    this.root.getElementById('mw-trigger').addEventListener('click', () => this.toggle());
    this.root.getElementById('mw-close').addEventListener('click', () => this.close());
    this.root.getElementById('mw-refresh').addEventListener('click', () => this.refreshAll());
    this.root.getElementById('mw-mark-all-read').addEventListener('click', () => this.markAllRead());
    this.root.getElementById('mw-back').addEventListener('click', () => this.showList());
    this.root.getElementById('mw-copy-diff').addEventListener('click', () => this.copyDiff());
    this.root.getElementById('mw-add-back').addEventListener('click', () => this.showList());
    this.root.getElementById('mw-add-cancel').addEventListener('click', () => this.showList());
    this.root.getElementById('mw-add-confirm').addEventListener('click', () => this.submitQuickAdd());

    this.initDrag();
    this.initResize();
    this.initNumericForm();

    for (const btn of this.root.querySelectorAll('.mw-view-btn')) {
      btn.addEventListener('click', () => {
        this.viewMode = btn.dataset.view;
        for (const b of this.root.querySelectorAll('.mw-view-btn')) {
          b.classList.toggle('active', b === btn);
        }
        this.renderList();
      });
    }

    for (const tab of this.root.querySelectorAll('.mw-tab')) {
      tab.addEventListener('click', () => {
        this.currentTab = tab.dataset.tab;
        for (const t of this.root.querySelectorAll('.mw-tab')) {
          t.classList.toggle('active', t === tab);
        }
        this.renderDiffContent();
      });
    }

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'CHANGE_DETECTED') {
        this.changes.unshift(msg.change);
        this.updateBadge();
        this.renderList();
      }
    });
  }

  initDrag() {
    const panel = this.root.getElementById('mw-panel');
    const header = this.root.querySelector('.mw-header');
    let dragging = false;
    let startX, startY, origRight, origBottom;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.mw-icon-btn, .mw-view-btn, .mw-view-toggle')) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      origRight = window.innerWidth - rect.right;
      origBottom = window.innerHeight - rect.bottom;
      panel.style.transition = 'none';
      header.style.cursor = 'grabbing';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const newRight = Math.max(0, origRight - dx);
      const newBottom = Math.max(0, origBottom + dy);
      panel.style.right = newRight + 'px';
      panel.style.bottom = newBottom + 'px';
    });

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      panel.style.transition = '';
      header.style.cursor = '';
    });
  }

  initResize() {
    const panel = this.root.getElementById('mw-panel');
    const handle = this.root.getElementById('mw-resize-handle');
    if (!handle) return;
    let resizing = false;
    let startX, startY, origW, origH, origRight, origBottom;

    handle.addEventListener('mousedown', (e) => {
      resizing = true;
      startX = e.clientX;
      startY = e.clientY;
      origW = panel.offsetWidth;
      origH = panel.offsetHeight;
      const rect = panel.getBoundingClientRect();
      origRight = window.innerWidth - rect.right;
      origBottom = window.innerHeight - rect.bottom;
      panel.style.transition = 'none';
      e.preventDefault();
      e.stopPropagation();
    });

    window.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      const dx = startX - e.clientX;
      const dy = startY - e.clientY;
      panel.style.width = Math.max(320, origW + dx) + 'px';
      panel.style.height = Math.max(400, origH + dy) + 'px';
    });

    window.addEventListener('mouseup', () => {
      if (!resizing) return;
      resizing = false;
      panel.style.transition = '';
    });
  }

  initNumericForm() {
    const toggle = this.root.getElementById('mw-add-numeric-toggle');
    const fields = this.root.getElementById('mw-add-numeric-fields');
    const modeSelect = this.root.getElementById('mw-add-numeric-mode');
    const templateGroup = this.root.getElementById('mw-add-template-group');
    const regexGroup = this.root.getElementById('mw-add-regex-group');

    if (!toggle || !fields) return;

    toggle.addEventListener('click', () => {
      toggle.classList.toggle('active');
      fields.classList.toggle('show', toggle.classList.contains('active'));
    });

    modeSelect?.addEventListener('change', () => {
      const mode = modeSelect.value;
      if (templateGroup) templateGroup.style.display = mode === 'template' ? '' : 'none';
      if (regexGroup) regexGroup.style.display = mode === 'regex' ? '' : 'none';
    });
  }

  toggle() {
    const panel = this.root.getElementById('mw-panel');
    const isOpen = panel.classList.toggle('open');
    if (isOpen) {
      this.root.getElementById('mw-trigger').classList.remove('has-unread');
      this.loadChanges();
    }
  }

  close() {
    this.root.getElementById('mw-panel').classList.remove('open');
  }

  async loadChanges() {
    try {
      const [changesResp, tasksResp] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_CHANGES' }),
        chrome.runtime.sendMessage({ type: 'GET_TASKS' }),
      ]);
      if (changesResp?.changes) this.changes = changesResp.changes;
      if (tasksResp?.tasks) this.tasks = tasksResp.tasks;
      this.updateBadge();
      this.renderList();
    } catch { /* extension context invalidated */ }
  }

  updateBadge() {
    const badge = this.root.getElementById('mw-badge');
    const trigger = this.root.getElementById('mw-trigger');
    const panel = this.root.getElementById('mw-panel');
    const count = this.changes.filter(c => !c.read).length;
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
    if (!panel.classList.contains('open')) {
      trigger.classList.toggle('has-unread', count > 0);
    }
  }

  renderList() {
    if (this.viewMode === 'tasks') {
      this.renderTasksView();
    } else {
      this.renderTimelineView();
    }
  }

  renderTasksView() {
    const body = this.root.getElementById('mw-body');
    const footer = this.root.getElementById('mw-footer-info');

    const grouped = new Map();
    for (const c of this.changes) {
      if (!grouped.has(c.taskId)) {
        grouped.set(c.taskId, []);
      }
      grouped.get(c.taskId).push(c);
    }

    const taskOrder = [];
    for (const task of this.tasks) {
      const taskChanges = grouped.get(task.id) || [];
      taskOrder.push({ task, changes: taskChanges });
    }

    for (const [taskId, changes] of grouped) {
      if (!this.tasks.find(t => t.id === taskId)) {
        taskOrder.push({ task: { id: taskId, name: changes[0]?.taskName || '未知', url: changes[0]?.url || '' }, changes });
      }
    }

    if (taskOrder.length === 0) {
      body.innerHTML = `
        <div class="mw-empty">
          <div class="mw-empty-icon">👁</div>
          <div class="mw-empty-text">暂无监控任务<br>在 Popup 中添加，或右键页面元素</div>
        </div>
      `;
      footer.textContent = '';
      return;
    }

    body.innerHTML = taskOrder.map(({ task, changes }) => {
      const unreadCount = changes.filter(c => !c.read).length;
      const latest = changes[0];
      const expanded = this.expandedTasks.has(task.id);
      const hasNumeric = changes.some(c => c.isNumeric);
      const domain = this.extractDomain(task.url);

      let sparklineHtml = '';
      if (hasNumeric) {
        sparklineHtml = `<canvas class="mw-task-group-sparkline" data-task-id="${task.id}"></canvas>`;
      }

      let changesHtml = '';
      if (expanded && changes.length > 0) {
        changesHtml = changes.slice(0, 20).map(c => {
          const cls = c.read ? '' : 'unread';
          const time = this.timeAgo(c.detectedAt);
          let valueHtml = '';
          if (c.isNumeric) {
            valueHtml = `<span class="mw-card-value">${c.numericValue}</span>`;
          }
          return `
            <div class="mw-change-card ${cls}" data-change-id="${c.id}">
              <div class="mw-change-card-left">
                <span class="mw-card-time">${time}</span>
                <div class="mw-card-stats">
                  ${valueHtml}
                  ${c.summary.addedLines > 0 ? `<span class="mw-stat-added">+${c.summary.addedLines}</span>` : ''}
                  ${c.summary.removedLines > 0 ? `<span class="mw-stat-removed">-${c.summary.removedLines}</span>` : ''}
                </div>
              </div>
            </div>
          `;
        }).join('');
        if (changes.length > 20) {
          changesHtml += `<div class="mw-timeline-fold">还有 ${changes.length - 20} 条更早的变化</div>`;
        }
      }

      return `
        <div class="mw-task-group">
          <div class="mw-task-group-header" data-task-id="${task.id}">
            <div class="mw-task-group-left">
              <div class="mw-task-group-name">${this.esc(task.name)}</div>
              <div class="mw-task-group-url">${this.esc(domain)}</div>
            </div>
            <div class="mw-task-group-right">
              ${sparklineHtml}
              ${unreadCount > 0 ? `<span class="mw-task-group-badge">${unreadCount}</span>` : ''}
              <span class="mw-task-group-arrow ${expanded ? 'expanded' : ''}">▸</span>
            </div>
          </div>
          <div class="mw-task-group-body ${expanded ? '' : 'collapsed'}">
            ${changesHtml || '<div style="padding:12px;color:#666;font-size:12px;text-align:center">暂无变化</div>'}
          </div>
        </div>
      `;
    }).join('');

    for (const header of body.querySelectorAll('.mw-task-group-header')) {
      header.addEventListener('click', () => {
        const taskId = header.dataset.taskId;
        if (this.expandedTasks.has(taskId)) {
          this.expandedTasks.delete(taskId);
        } else {
          this.expandedTasks.add(taskId);
        }
        this.renderList();
      });
    }

    for (const card of body.querySelectorAll('.mw-change-card')) {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        const changeId = card.dataset.changeId;
        const change = this.changes.find(ch => ch.id === changeId);
        if (change) this.showDetail(change);
      });
    }

    this.renderSparklines();

    const total = this.tasks.length;
    const withChanges = new Set(this.changes.map(c => c.taskId)).size;
    footer.textContent = `${total} 个任务 · ${withChanges} 个有变化`;
  }

  renderTimelineView() {
    const body = this.root.getElementById('mw-body');
    const footer = this.root.getElementById('mw-footer-info');

    if (this.changes.length === 0) {
      body.innerHTML = `
        <div class="mw-empty">
          <div class="mw-empty-icon">🕐</div>
          <div class="mw-empty-text">暂无变化记录</div>
        </div>
      `;
      footer.textContent = '';
      return;
    }

    const groups = [];
    let current = null;

    for (const c of this.changes) {
      if (current && current.taskId === c.taskId) {
        current.items.push(c);
      } else {
        current = { taskId: c.taskId, items: [c] };
        groups.push(current);
      }
    }

    let html = '';
    for (const group of groups) {
      const first = group.items[0];
      const cls = first.read ? '' : 'unread';
      const time = this.timeAgo(first.detectedAt);
      const domain = this.extractDomain(first.url);

      html += `
        <div class="mw-timeline-card ${cls}" data-change-id="${first.id}">
          <div class="mw-timeline-card-header">
            <span class="mw-timeline-card-name">${this.esc(first.taskName)}</span>
            <span class="mw-timeline-card-time">${time}</span>
          </div>
          <div class="mw-timeline-card-url">${this.esc(domain)}</div>
          <div class="mw-card-stats">
            ${first.isNumeric ? `<span class="mw-card-value">${first.numericValue}</span>` : ''}
            ${first.summary.addedLines > 0 ? `<span class="mw-stat-added">+${first.summary.addedLines}</span>` : ''}
            ${first.summary.removedLines > 0 ? `<span class="mw-stat-removed">-${first.summary.removedLines}</span>` : ''}
          </div>
        </div>
      `;

      if (group.items.length > 1) {
        html += `<div class="mw-timeline-fold" data-task-id="${group.taskId}">同一任务还有 ${group.items.length - 1} 条变化</div>`;
      }
    }

    body.innerHTML = html;

    for (const card of body.querySelectorAll('.mw-timeline-card')) {
      card.addEventListener('click', () => {
        const changeId = card.dataset.changeId;
        const change = this.changes.find(ch => ch.id === changeId);
        if (change) this.showDetail(change);
      });
    }

    footer.textContent = `${this.changes.length} 条变化`;
  }

  async renderSparklines() {
    const canvases = this.root.querySelectorAll('.mw-task-group-sparkline');
    if (canvases.length === 0) return;

    await this.ensureChart();
    if (!Chart) return;

    for (const canvas of canvases) {
      const taskId = canvas.dataset.taskId;
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'GET_NUMERIC_HISTORY', taskId });
        const history = resp?.history || [];
        if (history.length < 2) continue;

        new Chart(canvas.getContext('2d'), {
          type: 'line',
          data: {
            labels: history.map(() => ''),
            datasets: [{
              data: history.map(h => h.value),
              borderColor: '#8b5cf6',
              borderWidth: 1.5,
              pointRadius: 0,
              tension: 0.3,
              fill: {
                target: 'origin',
                above: 'rgba(139, 92, 246, 0.1)',
              },
            }],
          },
          options: {
            responsive: false,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: {
              x: { display: false },
              y: { display: false },
            },
            animation: false,
          },
        });
      } catch (err) {
        console.warn(`[MayWatch] Sparkline render failed for task ${taskId}:`, err);
      }
    }
  }

  async ensureChart() {
    Chart = Chart || globalThis.Chart;
    if (Chart) return;
    try {
      const url = chrome.runtime.getURL('lib/vendor/chart.umd.min.js');
      const mod = await import(url);
      Chart = globalThis.Chart || mod.Chart || mod.default?.Chart || mod.default;
      if (!Chart) {
        throw new Error('Chart.js loaded without exposing Chart');
      }
    } catch (err) {
      console.warn('[MayWatch] Chart.js load failed:', err);
    }
  }

  async showDetail(change) {
    this.currentChange = change;
    this.currentTab = 'summary';

    if (!change.read) {
      try {
        await chrome.runtime.sendMessage({ type: 'MARK_READ', changeId: change.id });
        change.read = true;
        this.updateBadge();
      } catch { /* ignore */ }
    }

    this.switchView('detail');
    this.root.getElementById('mw-detail-title').textContent = change.taskName;
    this.root.getElementById('mw-detail-meta').textContent =
      `${new Date(change.detectedAt).toLocaleString()} | ${this.extractDomain(change.url)}`;

    for (const t of this.root.querySelectorAll('.mw-tab')) {
      t.classList.toggle('active', t.dataset.tab === 'summary');
    }

    this.root.getElementById('mw-diff-stats').innerHTML = `
      <span class="mw-dot-added">+${change.summary.addedLines} 新增</span>
      <span class="mw-dot-removed">-${change.summary.removedLines} 删除</span>
    `;

    await this.renderTrendChart(change.taskId);
    this.renderDiffContent();
  }

  async renderTrendChart(taskId) {
    const container = this.root.getElementById('mw-chart-container');
    const canvas = this.root.getElementById('mw-trend-chart');

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_NUMERIC_HISTORY', taskId });
      const history = resp?.history || [];

      if (history.length < 2) {
        container.classList.add('hidden');
        return;
      }

      await this.ensureChart();
      if (!Chart) {
        container.classList.add('hidden');
        return;
      }

      container.classList.remove('hidden');

      if (this.trendChart) {
        this.trendChart.destroy();
        this.trendChart = null;
      }

      this.trendChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: history.map(h => {
            const d = new Date(h.timestamp);
            return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
          }),
          datasets: [{
            data: history.map(h => h.value),
            borderColor: '#8b5cf6',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#8b5cf6',
            tension: 0.3,
            fill: {
              target: 'origin',
              above: 'rgba(139, 92, 246, 0.15)',
            },
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#1a1a2e',
              borderColor: '#3a3a5a',
              borderWidth: 1,
              titleColor: '#e0e0e0',
              bodyColor: '#a78bfa',
              displayColors: false,
            },
          },
          scales: {
            x: {
              ticks: { color: '#666', font: { size: 10 }, maxTicksLimit: 6 },
              grid: { color: 'rgba(255,255,255,0.05)' },
            },
            y: {
              ticks: { color: '#666', font: { size: 10 } },
              grid: { color: 'rgba(255,255,255,0.05)' },
            },
          },
          animation: { duration: 300 },
        },
      });
    } catch (err) {
      console.warn(`[MayWatch] Trend chart render failed for task ${taskId}:`, err);
      container.classList.add('hidden');
    }
  }

  showList() {
    this.currentChange = null;
    if (this.trendChart) {
      this.trendChart.destroy();
      this.trendChart = null;
    }
    this.switchView('list');
    this.renderList();
  }

  switchView(view) {
    const list = this.root.getElementById('mw-list-view');
    const detail = this.root.getElementById('mw-detail-view');
    const add = this.root.getElementById('mw-add-view');

    list.style.display = view === 'list' ? 'flex' : 'none';
    detail.style.display = view === 'detail' ? 'flex' : 'none';
    add.style.display = view === 'add' ? 'flex' : 'none';
  }

  showQuickAdd(data) {
    const panel = this.root.getElementById('mw-panel');

    if (!panel.classList.contains('open')) {
      panel.classList.add('open');
      this.root.getElementById('mw-trigger').classList.remove('has-unread');
    }

    this.switchView('add');

    this.root.getElementById('mw-add-url').value = data.url || '';
    this.root.getElementById('mw-add-name').value = data.title || '';
    this.root.getElementById('mw-add-selector-type').value = 'xpath';
    this.root.getElementById('mw-add-selector').value = data.xpath || '';
    this.root.getElementById('mw-add-preview').textContent = data.text || '—';
    this.root.getElementById('mw-add-interval').value = '5';
    this.root.getElementById('mw-add-interval-unit').value = 's';

    const toggle = this.root.getElementById('mw-add-numeric-toggle');
    const fields = this.root.getElementById('mw-add-numeric-fields');
    if (toggle) toggle.classList.remove('active');
    if (fields) fields.classList.remove('show');
  }

  async submitQuickAdd() {
    const url = this.root.getElementById('mw-add-url').value.trim();
    const name = this.root.getElementById('mw-add-name').value.trim();
    const selectorType = this.root.getElementById('mw-add-selector-type').value;
    const selector = this.root.getElementById('mw-add-selector').value.trim();
    const rawInterval = Number(this.root.getElementById('mw-add-interval').value);
    const unit = this.root.getElementById('mw-add-interval-unit').value;
    const intervalSeconds = unit === 'm' ? rawInterval * 60 : rawInterval;

    if (!url) return;

    const numericToggle = this.root.getElementById('mw-add-numeric-toggle');
    const numericEnabled = numericToggle?.classList.contains('active') ?? false;

    const task = {
      id: crypto.randomUUID(),
      url,
      name: name || new URL(url).hostname,
      selector: selector || null,
      selectorType,
      interval: Math.max(1, Math.floor(intervalSeconds)),
      enabled: true,
      createdAt: Date.now(),
      lastCheckedAt: 0,
      numericMode: numericEnabled ? (this.root.getElementById('mw-add-numeric-mode')?.value || 'auto') : 'off',
      numericTemplate: this.root.getElementById('mw-add-numeric-template')?.value || 'with-unit',
      numericRegex: this.root.getElementById('mw-add-numeric-regex')?.value?.trim() || '',
    };

    try {
      await chrome.runtime.sendMessage({ type: 'SAVE_TASK', task });
      this.showToast(`已添加监控：${task.name}`);
      this.showList();
      await this.loadChanges();
    } catch (err) {
      console.warn('[MayWatch] Save task failed:', err);
    }
  }

  showToast(text) {
    const existing = this.root.querySelector('.mw-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'mw-toast';
    toast.textContent = text;
    this.root.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
  }

  renderDiffContent() {
    const container = this.root.getElementById('mw-diff-content');
    if (!this.currentChange) return;

    switch (this.currentTab) {
      case 'summary':
        container.innerHTML = this.renderSummaryView();
        break;
      case 'compare':
        container.innerHTML = this.renderCompareView();
        break;
      case 'raw':
        container.innerHTML = this.renderRawDiffView();
        break;
    }
  }

  renderSummaryView() {
    const s = this.currentChange.summary;
    let html = '<div class="mw-summary-section"><div class="mw-summary-label">📝 变化摘要</div>';

    if (this.currentChange.isNumeric) {
      html += `<div class="mw-summary-item"><span class="mw-dot-changed">● 当前值: ${this.currentChange.numericValue}</span></div>`;
    }
    if (s.addedLines > 0) {
      html += `<div class="mw-summary-item"><span class="mw-dot-added">● 新增 ${s.addedLines} 行</span></div>`;
    }
    if (s.removedLines > 0) {
      html += `<div class="mw-summary-item"><span class="mw-dot-removed">● 删除 ${s.removedLines} 行</span></div>`;
    }
    if (s.changedLines > 0) {
      html += `<div class="mw-summary-item"><span class="mw-dot-changed">● 约 ${s.changedLines} 处变更</span></div>`;
    }

    html += '</div>';

    if (s.addedSnippets.length > 0) {
      html += '<div style="margin-bottom:12px"><div style="font-size:11px;color:#4ade80;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px">▸ 新增内容</div>';
      for (const snip of s.addedSnippets) {
        html += `<div class="mw-snippet added">${this.esc(this.truncate(snip, 60))}</div>`;
      }
      if (s.addedLines > s.addedSnippets.length) {
        html += `<div class="mw-snippet-more">... 还有 ${s.addedLines - s.addedSnippets.length} 行</div>`;
      }
      html += '</div>';
    }

    if (s.removedSnippets.length > 0) {
      html += '<div style="margin-bottom:12px"><div style="font-size:11px;color:#f87171;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px">▸ 删除内容</div>';
      for (const snip of s.removedSnippets) {
        html += `<div class="mw-snippet removed">${this.esc(this.truncate(snip, 60))}</div>`;
      }
      if (s.removedLines > s.removedSnippets.length) {
        html += `<div class="mw-snippet-more">... 还有 ${s.removedLines - s.removedSnippets.length} 行</div>`;
      }
      html += '</div>';
    }

    return html;
  }

  renderCompareView() {
    const diff = this.currentChange.diff;
    let html = '';
    let unchangedCount = 0;
    const blocks = [];

    for (let i = 0; i < diff.length; i++) {
      const line = diff[i];
      if (line.type === 'unchanged') {
        unchangedCount++;
        continue;
      }

      if (unchangedCount > 0) {
        blocks.push({ type: 'collapsed', count: unchangedCount });
        unchangedCount = 0;
      }

      if (line.type === 'removed' && i + 1 < diff.length && diff[i + 1].type === 'added') {
        blocks.push({ type: 'changed', before: line.value, after: diff[i + 1].value });
        i++;
      } else if (line.type === 'added') {
        const lastBlock = blocks[blocks.length - 1];
        if (lastBlock && lastBlock.type === 'added-group') {
          lastBlock.lines.push(line.value);
        } else {
          blocks.push({ type: 'added-group', lines: [line.value] });
        }
      } else if (line.type === 'removed') {
        const lastBlock = blocks[blocks.length - 1];
        if (lastBlock && lastBlock.type === 'removed-group') {
          lastBlock.lines.push(line.value);
        } else {
          blocks.push({ type: 'removed-group', lines: [line.value] });
        }
      }
    }

    if (unchangedCount > 0) {
      blocks.push({ type: 'collapsed', count: unchangedCount });
    }

    for (const block of blocks) {
      if (block.type === 'collapsed') {
        html += `<button class="mw-collapsed-block"><span>▸</span> ${block.count} 段未变化内容</button>`;
      } else if (block.type === 'added-group') {
        html += `<div class="mw-compare-block added"><span class="mw-block-label added">新增</span>`;
        html += `<div class="mw-block-content added-text">${block.lines.map(l => this.esc(l)).join('<br>')}</div></div>`;
      } else if (block.type === 'removed-group') {
        html += `<div class="mw-compare-block removed"><span class="mw-block-label removed">已移除</span>`;
        html += `<div class="mw-block-content removed-text">${block.lines.map(l => this.esc(l)).join('<br>')}</div></div>`;
      } else if (block.type === 'changed') {
        html += `<div class="mw-compare-block changed"><span class="mw-block-label changed">变更</span>`;
        html += `<div class="mw-change-pair">`;
        html += `<div class="mw-change-side before"><div class="mw-change-side-label">Before</div>${this.esc(block.before)}</div>`;
        html += `<div class="mw-change-side after"><div class="mw-change-side-label">After</div>${this.esc(block.after)}</div>`;
        html += `</div></div>`;
      }
    }

    return html;
  }

  renderRawDiffView() {
    const diff = this.currentChange.diff;
    let lineNum = 0;
    let html = '<div class="mw-raw-diff">';

    for (const line of diff) {
      lineNum++;
      const cls = line.type;
      const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
      html += `<div class="mw-diff-line ${cls}">`;
      html += `<span class="mw-line-num">${lineNum}</span>`;
      html += `<span class="mw-line-text ${cls}">${prefix} ${this.esc(line.value)}</span>`;
      html += `</div>`;
    }

    html += '</div>';
    return html;
  }

  async refreshAll() {
    const btn = this.root.getElementById('mw-refresh');
    btn.disabled = true;
    btn.textContent = '⏳';

    try {
      await chrome.runtime.sendMessage({ type: 'CHECK_NOW' });
      await this.loadChanges();
    } catch { /* ignore */ }

    btn.disabled = false;
    btn.textContent = '🔄';
  }

  async markAllRead() {
    try {
      await chrome.runtime.sendMessage({ type: 'MARK_ALL_READ' });
      for (const c of this.changes) c.read = true;
      this.updateBadge();
      this.renderList();
    } catch { /* ignore */ }
  }

  copyDiff() {
    if (!this.currentChange) return;
    const lines = this.currentChange.diff.map(l => {
      const prefix = l.type === 'added' ? '+' : l.type === 'removed' ? '-' : ' ';
      return `${prefix} ${l.value}`;
    });
    navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
  }

  timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}秒前`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}小时前`;
    const days = Math.floor(hours / 24);
    return `${days}天前`;
  }

  extractDomain(url) {
    try { return new URL(url).hostname; } catch { return url; }
  }

  truncate(str, max = 80) {
    return str.length <= max ? str : str.slice(0, max - 1) + '…';
  }

  esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
}
