# MayWatch 数值追踪与趋势图修复执行 Plan

## 1. 计划信息

- 状态：Implementation complete（自动验证完成，待 unpacked extension 手工验收）
- 对应 Spec：[`numeric-trend-chart-fix-spec.md`](./numeric-trend-chart-fix-spec.md)
- 基线提交：`95be558ae32c1e96b1ba1cb2dbe79a0552dd0e9a`
- 目标版本：`1.0.1`
- 预计提交数：4
- 实施原则：先修复可测试的数据链路，再接入图表和 UI；每个阶段通过验证门槛后再进入下一阶段

### 执行记录（2026-07-15）

- 已在 `fix/numeric-trend-charts` 分支完成后台采样、存储、Chart.js 加载、面板状态和任务生命周期修改。
- 已添加零依赖 `node:test` 回归测试，覆盖数值提取、基线、去重、100 点上限、关闭数值追踪、清理和 UMD 加载。
- 已通过测试、JavaScript 语法检查、manifest JSON 解析和 `git diff --check`。
- 待办：在 Chrome 中以 unpacked extension 加载后执行本计划第 9 节的手工验收路径。

## 2. 最终交付物

- 可在 Chrome MV3 内容脚本环境中加载的本地 Chart.js。
- 独立于文本 diff 的数值提取和历史采样链路。
- 首个有效值作为基线，后续仅记录不同数值。
- 0 点、1 点、2+ 点和加载失败四种可识别 UI 状态。
- 正确销毁和重建的迷你图、趋势图实例。
- 任务编辑、删除时一致的快照与数值历史生命周期。
- 覆盖回归场景的自动测试和手工验收记录。
- 与真实行为一致的中英文 README。

## 3. 阶段与依赖

```text
阶段 0：测试基础与基线确认
  ├─→ 阶段 1：数值提取与存储
  │     └─→ 阶段 2：调度器采样链路
  │             └─→ 阶段 3：Chart.js 加载与面板状态
  │                     └─→ 阶段 4：生命周期清理与兼容
  │                             └─→ 阶段 5：集成验收与文档
```

阶段 1 和阶段 3 的局部编码可以并行，但合并顺序必须保持“数据层在前、UI 在后”。

## 4. 阶段 0：测试基础与基线确认

### 目标

建立可重复验证当前缺陷和后续修复的最小环境。

### 任务

- [ ] 确认仓库当前没有既有测试框架或测试脚本。
- [ ] 选择零构建依赖的测试方式，优先使用 Node 内置 `node:test`。
- [ ] 为 Chrome API 建立最小 mock：
  - [ ] `chrome.storage.local.get/set/remove`
  - [ ] `chrome.runtime.getURL/sendMessage`
- [ ] 准备数值监控测试夹具：首次值 100、相同值 100、变化值 101、无效文本。
- [ ] 记录修复前基线：
  - [ ] UMD 动态导入模块命名空间不包含 `Chart`。
  - [ ] 首次快照不会写入 numeric history。
  - [ ] 单次变化后 history 只有一个点。
  - [ ] 图表容器保持隐藏。

### 输出

- 测试目录和 Chrome API mock。
- 至少一个能稳定重现数值基线缺失的失败测试。
- Chart.js 加载行为的最小回归测试或可重复验证脚本。

### 完成门槛

- 测试命令可以在干净仓库中一次运行。
- 失败用例与 Spec 中描述的当前故障一致，而非环境配置问题。

## 5. 阶段 1：数值提取与存储层

### 目标

把数值提取从 diff change record 中解耦，并提供去重写入能力。

### 任务

- [ ] 新增 `background/numeric.js`。
- [ ] 移入现有数值模板：
  - [ ] `integer`
  - [ ] `decimal`
  - [ ] `with-unit`
  - [ ] `currency`
- [ ] 实现结构化提取结果：`ok`、`value`、`reason`。
- [ ] 保持 auto、template、regex 现有匹配语义。
- [ ] 使用 `Number.isFinite()` 拒绝非法数值。
- [ ] 修改 `background/differ.js`，复用公共提取结果，不保留重复实现。
- [ ] 在 `background/storage.js` 新增：
  - [ ] `addNumericPointIfChanged()`
  - [ ] `clearNumericHistory()`
  - [ ] 历史项合法性校验
- [ ] 保持历史数据结构 `{ value, timestamp }` 和 100 点上限不变。

### 测试

- [ ] auto 模式覆盖整数、负数、小数、千分位、货币和百分比。
- [ ] 四个模板各至少一个成功和一个失败用例。
- [ ] regex 覆盖捕获组、完整匹配、无效正则、无匹配。
- [ ] 第一个点写入成功。
- [ ] 相同值不重复写入。
- [ ] 不同值追加成功。
- [ ] 第 101 个点写入后只保留最后 100 个。
- [ ] 损坏历史项在读取时被过滤。

### 完成门槛

- 数值提取测试全部通过。
- 存储去重和上限测试全部通过。
- `differ.js` 中不存在第二套数值模板或解析逻辑。

### 建议提交

```text
fix(numeric): extract and deduplicate numeric history
```

## 6. 阶段 2：调度器采样链路

### 目标

保证第一次成功检查即记录数值基线，并使数值采样不依赖文本 diff。

### 任务

- [ ] 在 `background/scheduler.js` 中导入公共提取函数和去重存储接口。
- [ ] 页面内容获取成功后立即执行数值提取。
- [ ] 在 `first_snapshot` 提前返回前写入有效基线值。
- [ ] 在 `no_change` 提前返回前完成数值采样判断。
- [ ] 将同一次提取结果传给 `createChangeRecord()`。
- [ ] 保持以下现有行为不变：
  - [ ] 无文本变化时不创建 change record。
  - [ ] 无文本变化时不发送飞书通知。
  - [ ] 页面获取失败时不更新 snapshot 和 numeric history。
- [ ] 为写入失败补充包含 task ID 的日志或错误上下文。

### 测试

- [ ] 首次检查得到 100：history 为 `[100]`，无 change。
- [ ] 第二次仍为 100：history 仍为 `[100]`，无 change。
- [ ] 第二次变为 101：history 为 `[100, 101]`，产生 numeric change。
- [ ] 文本改变但提取值相同：产生 change，history 不重复。
- [ ] 提取失败：history 不变，普通 diff 仍按原逻辑工作。
- [ ] 获取失败：snapshot 和 history 均不改变。
- [ ] numeric mode 为 off：不调用数值历史写入。

### 完成门槛

- 基线值和第一次不同值能形成两个点。
- 所有提前返回分支均有明确测试。
- 普通非数值监控回归测试通过。

### 建议提交

```text
fix(scheduler): sample numeric values independently from text diff
```

## 7. 阶段 3：Chart.js 加载与面板状态

### 目标

移除 CSP 不兼容的 Blob 加载，并让用户能区分数据不足与渲染失败。

### 任务

- [ ] 修改 `content/panel.js` 的 `ensureChart()`：
  - [ ] 直接 `import(chrome.runtime.getURL(...))`。
  - [ ] 从 `globalThis.Chart` 获取 UMD 构造器。
  - [ ] 使用共享 Promise 避免并发重复加载。
  - [ ] 失败后清除 Promise，允许重试。
  - [ ] 构造器缺失时抛出明确错误。
- [ ] 删除 fetch、Blob、`createObjectURL()` 和 `revokeObjectURL()` 路径。
- [ ] 确认 `manifest.json` 继续声明 Chart.js 为 web accessible resource。
- [ ] 在 `content/panel.html` 增加图表状态节点。
- [ ] 在 `content/panel.css` 增加 empty、insufficient、error 样式。
- [ ] 在 `content/panel.js` 实现统一历史状态判断。
- [ ] 任务是否为数值任务改用 `task.numericMode !== 'off'` 判断。
- [ ] 详情页状态：
  - [ ] 0 点：尚未采集有效数值。
  - [ ] 1 点：显示当前值并提示需要第二个不同值。
  - [ ] 2+ 点：显示趋势图。
  - [ ] 失败：显示加载失败状态。
- [ ] 使用 `Map` 管理迷你图实例。
- [ ] 列表重绘前销毁旧迷你图。
- [ ] 离开详情页时销毁趋势图。
- [ ] 将空 catch 改为包含 task ID 的诊断日志。

### 测试

- [ ] `ensureChart()` 返回函数类型的构造器。
- [ ] 并发三次调用只执行一次模块导入。
- [ ] 第一次加载失败后可以重试。
- [ ] 0、1、2+ 点分别进入正确 UI 状态。
- [ ] 多次列表重绘不会出现 canvas 重用错误。
- [ ] 多次进入、离开详情页不会遗留 Chart 实例。
- [ ] 模拟 Chart 构造异常时显示 error 状态。

### 浏览器验证

- [ ] Chrome 内容脚本控制台没有 `blob:` CSP 错误。
- [ ] 没有 `Chart is not defined` 或“Canvas is already in use”错误。
- [ ] 宿主页面无法直接读取内容脚本隔离世界中的 Chart 变量。

### 完成门槛

- 两个有效点能稳定显示迷你图和趋势图。
- 图表失败不再表现为无提示空白。
- 打开多个标签页验证均正常。

### 建议提交

```text
fix(chart): load bundled UMD and expose numeric chart states
```

## 8. 阶段 4：任务生命周期与兼容处理

### 目标

防止删除任务后残留数据，以及编辑监控语义后混用旧序列。

### 任务

- [ ] 在 `background/storage.js` 新增 `resetTaskRuntimeData(taskId)`。
- [ ] 删除任务时清理 snapshot 和 numeric history。
- [ ] `SAVE_TASK` 前读取旧任务。
- [ ] 比较语义字段：
  - [ ] `url`
  - [ ] `selector`
  - [ ] `selectorType`
  - [ ] `numericMode`
  - [ ] `numericTemplate`
  - [ ] `numericRegex`
- [ ] 上述字段发生变化时清理 snapshot 和 numeric history。
- [ ] 仅修改 name、interval、enabled 时保留历史。
- [ ] 在 Popup 编辑表单中提示语义修改会重置运行数据。
- [ ] 读取旧历史时兼容现有 `{ value, timestamp }` 数据。

### 测试

- [ ] 删除任务后相关两个 storage key 均不存在。
- [ ] 修改 URL 或 selector 后历史和快照清空。
- [ ] 修改数值模式、模板或正则后历史和快照清空。
- [ ] 修改名称或间隔后历史保持。
- [ ] 旧版本历史可直接读取并渲染。
- [ ] 损坏条目被过滤后不阻断渲染。

### 完成门槛

- 不会出现不同 URL、selector 或提取规则的数据混合在同一张图中。
- 兼容数据无需一次性迁移即可正常使用。

## 9. 阶段 5：集成验收与文档

### 目标

完成端到端验证并让 README 与最终行为一致。

### 任务

- [ ] 建立或准备本地可控数字页面。
- [ ] 在 Chrome 中以 unpacked extension 方式重新加载扩展。
- [ ] 执行完整手工验收路径。
- [ ] 验证 auto、四种 template 和 regex。
- [ ] 验证 Popup 创建和浮动面板快速创建两条入口。
- [ ] 验证 service worker 休眠、唤醒后历史仍存在。
- [ ] 验证宿主页刷新和多个标签页。
- [ ] 更新 `README.md`。
- [ ] 更新 `README_CN.md`。
- [ ] 删除“Blob URL 规避 CSP”描述。
- [ ] 明确两个有效点后显示趋势。
- [ ] 明确默认只记录首个值和后续不同值。
- [ ] 更新版本号和变更记录（若项目采用版本记录）。

### 手工验收路径

1. 创建数值任务，页面初始值为 100。
2. 第一次检查后确认当前值为 100，历史为 1 点，显示数据不足状态。
3. 页面保持 100 再次检查，确认历史仍为 1 点。
4. 页面改为 101 并检查，确认历史为 2 点。
5. 确认任务列表出现迷你图。
6. 点击变化记录，确认详情图包含 100 和 101。
7. 页面改为 102，确认图表追加第三点。
8. 重载宿主页和扩展，确认图表可恢复。
9. 修改 selector，确认旧历史清空并重新建立基线。
10. 删除任务，确认运行数据被清理。

### 完成门槛

- Spec 第 9 节的验收标准全部通过。
- 自动测试全部通过。
- `git diff --check` 通过。
- Chrome 扩展相关控制台无未解释错误。
- README 中英文行为描述一致。

### 建议提交

```text
docs(test): cover numeric charts and align tracking documentation
```

## 10. 回归检查矩阵

| 功能 | Chrome API mock | 自动测试 | 手工浏览器 |
|---|---:|---:|---:|
| 普通文本监控 | 是 | 是 | 是 |
| auto 数值提取 | 否 | 是 | 是 |
| template 数值提取 | 否 | 是 | 是 |
| regex 数值提取 | 否 | 是 | 是 |
| 首次基线 | 是 | 是 | 是 |
| 相同值去重 | 是 | 是 | 是 |
| 100 点上限 | 是 | 是 | 可选 |
| 迷你图 | 是 | 尽可能 | 是 |
| 详情趋势图 | 是 | 尽可能 | 是 |
| Chart.js CSP | 否 | 否 | 必须 |
| 任务编辑重置 | 是 | 是 | 是 |
| 任务删除清理 | 是 | 是 | 是 |
| service worker 重启 | 否 | 否 | 必须 |
| 飞书通知回归 | 是 | 是 | 可选 |

## 11. 停止条件与问题处理

出现以下任一情况时，不进入下一阶段：

- 公共数值提取函数与 change record 的结果不一致。
- 首次检查仍不能建立基线点。
- Chart.js 仍需要 Blob、远程脚本或放宽 CSP 才能运行。
- 两个点存在但图表仍无错误提示地隐藏。
- 列表重绘产生未销毁的 Chart 实例。
- 编辑任务后不同监控语义的数据仍可能混合。
- 普通文本监控、diff 或通知行为出现回归。

阻塞问题应记录：复现步骤、预期结果、实际结果、控制台错误、相关 storage 内容和影响阶段。

## 12. Definition of Done

- [ ] 阶段 0 至阶段 5 的完成门槛全部满足。
- [ ] 所有验收标准有测试或手工记录对应。
- [ ] 代码中不存在旧 Blob Chart.js 加载路径。
- [ ] 首个有效值和第一次不同值能形成可见趋势。
- [ ] 用户可以识别无数据、数据不足和图表失败。
- [ ] 数值历史不会因重复轮询无意义增长。
- [ ] 任务编辑、删除的数据生命周期符合 Spec。
- [ ] 中英文 README 与实际实现一致。
- [ ] 最终 diff 无格式错误、调试代码或无说明的静默 catch。
