<div align="center">

<img src="icons/icon128.png" alt="MayWatch" width="80" />

# MayWatch

**A sleek Chrome extension for monitoring web page changes in real time.**

Track elements, visualize diffs, chart numeric trends, and get notified — all from a beautiful floating panel.

[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![License: MIT](https://img.shields.io/badge/License-MIT-a78bfa)](LICENSE)

[**中文文档 →**](README_CN.md)

</div>

---

## ✨ Features

| Category | Details |
|---|---|
| **Multi-target monitoring** | Watch full pages or pinpoint elements via **CSS selectors** and **XPath** |
| **Sub-second polling** | Intervals down to **1 second** using `setInterval` (bypasses `chrome.alarms` 1-min limit) |
| **Three-tier diff** | Summary → Side-by-side comparison → Raw unified diff |
| **Numeric tracking** | Auto / template / regex extraction with **Chart.js sparklines & trend charts** |
| **Floating card panel** | Glass-morphism card (380×520), draggable, resizable, Shadow DOM isolated |
| **Right-click quick add** | Context menu "Monitor this element" captures XPath & CSS selector automatically |
| **Feishu bot notification** | Webhook push with optional **HMAC-SHA256 signing** |
| **Dual view** | Task-grouped aggregation view + chronological timeline view |
| **Pure local storage** | All data stays in `chrome.storage.local` — zero external dependencies |

---

## 📸 Screenshots

> _Coming soon — install and try it yourself!_

---

## 🏗 Architecture

```
mayWatch/
├── manifest.json              # Chrome MV3 manifest
├── background/
│   ├── service-worker.js      # Message hub & context menu handler
│   ├── scheduler.js           # setInterval-based polling engine
│   ├── fetcher.js             # Tab-first extraction → Offscreen fallback
│   ├── differ.js              # Myers diff + configurable numeric extraction
│   ├── storage.js             # chrome.storage.local CRUD
│   ├── notifier.js            # Feishu webhook (HMAC-SHA256)
│   ├── parser.js              # Offscreen Document DOMParser script
│   └── offscreen.html         # Offscreen Document host
├── content/
│   ├── content-script.js      # Shadow DOM injection + contextmenu capture
│   ├── panel.js               # Floating panel UI logic (dual view, charts, drag)
│   ├── panel.html             # Panel HTML template
│   └── panel.css              # Glass-morphism card styles
├── popup/
│   ├── popup.html             # Extension popup — task & settings management
│   ├── popup.js               # Popup logic (CRUD, Feishu config, numeric fields)
│   └── popup.css              # Popup styles
├── lib/
│   ├── diff.js                # Zero-dependency Myers diff implementation
│   └── vendor/
│       └── chart.umd.min.js   # Chart.js 4.4.7
├── utils/
│   └── common.js              # generateId, timeAgo, normalizeText, etc.
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Core Data Flow

```
Scheduler (1s tick)
    → Fetcher (live tab extraction / offscreen fetch+parse)
    → Differ (Myers diff + numeric extract)
    → Storage (snapshots, changes, numeric history)
    → Broadcast (runtime + tabs messaging)
    → Notifier (optional Feishu webhook)
    → Panel UI (Shadow DOM floating card)
```

---

## 🚀 Installation

### From Source (Developer Mode)

1. **Clone the repository**

   ```bash
   git clone https://github.com/MayMistery/mayWatch.git
   ```

2. **Open Chrome** and navigate to `chrome://extensions/`

3. Enable **Developer mode** (toggle in top-right)

4. Click **Load unpacked** and select the `mayWatch` folder

5. The MayWatch icon appears in your toolbar — you're ready to go!

> No build step required. No `npm install`. Just load and use.

---

## 📖 Usage

### Create a Monitoring Task

**Option A — Popup:**
Click the MayWatch icon in the toolbar → **+ Add Monitor** → fill in URL, selector, interval.

**Option B — Right-click:**
Right-click any element on a webpage → **"Monitor this element with MayWatch"** → the floating panel opens with XPath and CSS selector pre-filled.

### View Changes

Click the floating eye icon (bottom-right corner) to open the panel:
- **Tasks view** — changes grouped by task, with sparkline previews
- **Timeline view** — all changes in chronological order
- Click any change to see the **three-tier diff** (Summary / Compare / Raw)

### Numeric Tracking

When creating a task, enable **Numeric Tracking** and choose a mode:
| Mode | Description |
|---|---|
| `auto` | Broad regex that catches most numbers |
| `template` | Presets: integer, decimal, with-unit (`11812ms`), currency (`¥89.9`) |
| `regex` | Your own capture group, e.g. `(\d+)ms` |

The first check records a numeric baseline. After the first numeric change, values are plotted as **sparklines** in the task list and **trend charts** in the detail view.

### Feishu Notification

1. Open the **Popup** → expand **Notification Settings**
2. Paste your Feishu custom bot **Webhook URL**
3. (Optional) Enter the **Secret** for HMAC-SHA256 signing
4. Toggle on and click **Test** to verify

---

## ⚙️ Configuration

| Setting | Location | Default |
|---|---|---|
| Global enable/disable | Popup toggle | On |
| Per-task interval | Task form | 5 seconds |
| Selector type | Task form | CSS / XPath |
| Numeric mode | Task form | Off |
| Max stored changes | `storage.js` | 100 |
| Feishu webhook | Popup → Notification Settings | — |

---

## 🔧 Technical Highlights

- **Manifest V3** — fully compliant with Chrome's latest extension platform
- **Offscreen Document API** — `DOMParser` in Service Worker context via offscreen page
- **Tab-first extraction** — `chrome.scripting.executeScript` for live SPA DOM, with fetch+parse fallback
- **Shadow DOM isolation** — panel styles never leak to or from the host page
- **Zero build tooling** — pure ES modules, no bundler, no transpiler
- **Chart.js extension resource** — loaded on demand for the Shadow DOM panel without relying on page scripts

---

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/awesome-feature`)
3. Commit your changes (`git commit -m 'feat: add awesome feature'`)
4. Push to the branch (`git push origin feat/awesome-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<div align="center">
  <sub>Built with ❤️ by <a href="https://github.com/MayMistery">MayMistery</a></sub>
</div>
