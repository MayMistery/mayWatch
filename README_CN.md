<div align="center">

<img src="icons/icon128.png" alt="MayWatch" width="80" />

# MayWatch

**一款精致的 Chrome 扩展，实时监控网页变化。**

追踪元素变化、可视化 diff、绘制数值趋势图、即时通知 — 一切尽在优雅的悬浮面板中。

[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![License: MIT](https://img.shields.io/badge/License-MIT-a78bfa)](LICENSE)

[**English →**](README.md)

</div>

---

## ✨ 功能特性

| 分类 | 说明 |
|---|---|
| **多目标监控** | 支持全页监控，也可通过 **CSS 选择器** 或 **XPath** 精确定位元素 |
| **亚秒级轮询** | 间隔最低 **1 秒**，使用 `setInterval` 绕过 `chrome.alarms` 的 1 分钟限制 |
| **三层 Diff** | 摘要概览 → 并排对比 → 原始 unified diff |
| **数值追踪** | 自动/模板/正则提取，配合 **Chart.js 迷你图 & 趋势图** |
| **悬浮卡片面板** | 毛玻璃风格卡片 (380×520)，可拖拽、可缩放，Shadow DOM 样式隔离 |
| **右键快速添加** | 右键菜单「用 MayWatch 监控此元素」，自动捕获 XPath 与 CSS 选择器 |
| **飞书机器人通知** | Webhook 推送，支持 **HMAC-SHA256 签名校验** |
| **双视图模式** | 按任务分组的聚合视图 + 按时间排列的时间流视图 |
| **纯本地存储** | 所有数据存储在 `chrome.storage.local`，零外部依赖 |

---

## 📸 截图

> _即将更新 — 安装后即可体验！_

---

## 🏗 项目结构

```
mayWatch/
├── manifest.json              # Chrome MV3 清单文件
├── background/
│   ├── service-worker.js      # 消息中枢 & 右键菜单处理
│   ├── scheduler.js           # 基于 setInterval 的轮询引擎
│   ├── fetcher.js             # 优先从标签页提取 → Offscreen 兜底
│   ├── differ.js              # Myers diff + 可配置数值提取
│   ├── storage.js             # chrome.storage.local 数据存取
│   ├── notifier.js            # 飞书 Webhook 通知 (HMAC-SHA256)
│   ├── parser.js              # Offscreen Document DOMParser 脚本
│   └── offscreen.html         # Offscreen Document 宿主页
├── content/
│   ├── content-script.js      # Shadow DOM 注入 + contextmenu 事件捕获
│   ├── panel.js               # 悬浮面板 UI 逻辑 (双视图、图表、拖拽)
│   ├── panel.html             # 面板 HTML 模板
│   └── panel.css              # 毛玻璃卡片样式
├── popup/
│   ├── popup.html             # 扩展弹窗 — 任务与设置管理
│   ├── popup.js               # 弹窗逻辑 (CRUD、飞书配置、数值字段)
│   └── popup.css              # 弹窗样式
├── lib/
│   ├── diff.js                # 零依赖 Myers diff 实现
│   └── vendor/
│       └── chart.umd.min.js   # Chart.js 4.4.7
├── utils/
│   └── common.js              # generateId, timeAgo, normalizeText 等工具
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### 核心数据流

```
调度器 (1s 心跳)
    → 抓取器 (优先标签页内提取 / Offscreen fetch+解析)
    → 差异器 (Myers diff + 数值提取)
    → 存储层 (快照、变更记录、数值历史)
    → 广播 (runtime + tabs 消息通道)
    → 通知器 (可选飞书 Webhook)
    → 面板 UI (Shadow DOM 悬浮卡片)
```

---

## 🚀 安装

### 从源码加载（开发者模式）

1. **克隆仓库**

   ```bash
   git clone https://github.com/MayMistery/mayWatch.git
   ```

2. 打开 Chrome，访问 `chrome://extensions/`

3. 开启右上角的 **开发者模式**

4. 点击 **加载已解压的扩展程序**，选择 `mayWatch` 文件夹

5. 工具栏出现 MayWatch 图标，即可使用！

> 无需构建，无需 `npm install`，加载即用。

---

## 📖 使用指南

### 创建监控任务

**方式一 — 弹窗：**
点击工具栏 MayWatch 图标 → **+ 添加监控** → 填写 URL、选择器、间隔。

**方式二 — 右键菜单：**
在网页上右键任意元素 → **「用 MayWatch 监控此元素」** → 悬浮面板自动打开，XPath 和 CSS 选择器已自动填充。

### 查看变化

点击页面右下角的悬浮眼睛图标，打开面板：
- **任务视图** — 变化按任务分组，附带迷你趋势图
- **时间流视图** — 所有变化按时间排列
- 点击任意变化记录，查看 **三层 Diff**（摘要 / 对比 / 原始）

### 数值追踪

创建任务时开启 **数值追踪**，选择提取模式：

| 模式 | 说明 |
|---|---|
| `auto` | 宽泛正则，自动匹配大部分数字 |
| `template` | 预置模板：纯整数、小数、带单位（`11812ms`）、货币（`¥89.9`） |
| `regex` | 自定义正则捕获组，如 `(\d+)ms` |

首次检查会记录一个数值基准点；后续第一次数值变化后，任务列表会显示 **迷你折线图**，详情页会显示 **完整趋势图**。

### 飞书通知

1. 打开弹窗 → 展开 **通知设置**
2. 粘贴飞书自定义机器人的 **Webhook URL**
3. （可选）输入 **签名密钥 (Secret)** 以启用 HMAC-SHA256 校验
4. 开启开关，点击 **测试** 验证

> 获取 Webhook URL：在飞书群聊中，进入 **设置 → 群机器人 → 添加机器人 → 自定义机器人**，创建后即可获得 Webhook 地址。

---

## ⚙️ 配置项

| 配置 | 位置 | 默认值 |
|---|---|---|
| 全局启用/禁用 | 弹窗顶部开关 | 开启 |
| 单任务检查间隔 | 任务表单 | 5 秒 |
| 选择器类型 | 任务表单 | CSS / XPath |
| 数值追踪模式 | 任务表单 | 关闭 |
| 最大存储变更数 | `storage.js` | 100 |
| 飞书 Webhook | 弹窗 → 通知设置 | — |

---

## 🔧 技术亮点

- **Manifest V3** — 完全兼容 Chrome 最新扩展平台
- **Offscreen Document API** — 在 Service Worker 中通过离屏文档使用 `DOMParser`
- **标签页优先提取** — `chrome.scripting.executeScript` 获取 SPA 实时 DOM，fetch 兜底
- **Shadow DOM 隔离** — 面板样式与宿主页面完全互不干扰
- **零构建工具链** — 纯 ES Modules，无打包器，无转译器
- **Chart.js 扩展资源加载** — 在 Shadow DOM 面板中按需加载扩展内置的 Chart.js，不依赖页面脚本

---

## 🤝 贡献

欢迎贡献！请随时提 Issue 或提交 Pull Request。

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feat/awesome-feature`)
3. 提交更改 (`git commit -m 'feat: add awesome feature'`)
4. 推送分支 (`git push origin feat/awesome-feature`)
5. 发起 Pull Request

---

## 📄 许可证

本项目使用 [MIT License](LICENSE) 开源。

---

<div align="center">
  <sub>由 <a href="https://github.com/MayMistery">MayMistery</a> 用 ❤️ 构建</sub>
</div>
