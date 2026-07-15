# MayWatch 数值追踪与趋势图修复实施 Spec

## 1. 文档信息

- 状态：Implemented（自动验证完成，待 unpacked extension 手工验收）
- 目标版本：`1.0.1`
- 基线提交：`95be558ae32c1e96b1ba1cb2dbe79a0552dd0e9a`
- 影响范围：后台采样、数值提取、本地存储、浮动面板、任务编辑与删除、测试
- 不涉及：飞书通知协议重构、普通文本 diff 算法重构、图表样式整体改版、跨设备同步

## 2. 背景与问题定义

README 宣称数值追踪支持自动、模板和正则提取，并在任务列表与详情页展示迷你图和趋势图。当前实现存在以下问题：

1. `content/panel.js` 将 Chart.js UMD 文件转换为 Blob 后通过 `import()` 加载。Chrome MV3 内容脚本 CSP 不允许 `blob:` 脚本来源。
2. Chart.js UMD 构建不会提供 ESM 的 `default` 或 `Chart` 导出，而是写入 `globalThis.Chart`；当前代码只读取模块命名空间，导致局部 `Chart` 保持 `undefined`。
3. 第一次检查只保存文本快照，不保存初始数值。
4. 数值提取依赖文本 diff；没有文本变化时不会执行数值采样。
5. 图表要求至少两个历史点，因此“初始值 → 第一次变化”后仍只有一个点，图表继续隐藏。
6. 图表加载、历史不足和渲染错误都以静默返回或隐藏处理，用户无法区分“数据不足”和“功能故障”。
7. 删除任务不会删除对应的数值历史。

## 3. 实施目标

完成后必须满足：

1. Chart.js 能在 MV3 内容脚本的隔离环境中稳定加载，不使用 Blob、`eval`、远程脚本或内联执行。
2. 启用数值追踪的任务在第一次成功检查时记录基线数值。
3. 数值采样与文本 diff 解耦；每次成功取得内容后都可以进行数值提取。
4. 默认只保存“首个有效值”和“与上一历史点不同的值”，避免固定轮询产生大量重复点。
5. 第二个不同数值出现后，任务迷你图和详情趋势图可以立即显示。
6. 数据不足、提取失败和图表加载失败必须具有可诊断状态。
7. 删除任务或修改会改变数值语义的任务字段时，不保留不兼容的历史数据。

## 4. 非目标

本次不实现以下能力：

- 按固定时间间隔保存相同数值。
- 无限历史或长期时序数据库。
- 多条数值序列或一次提取多个捕获组。
- 聚合、降采样、缩放、导出 CSV。
- 在 Popup 中新增完整趋势图。

## 5. 产品语义

### 5.1 数值历史的定义

数值历史代表“监控对象的有效数值状态变化”，不是每次轮询日志。

每个点保持现有结构：

```js
{
  value: number,
  timestamp: number
}
```

采样规则：

- 数值追踪关闭：不提取、不写入。
- 第一次提取成功：写入基线点。
- 后续提取成功且数值不同于最后一个历史点：写入新点。
- 后续提取成功但数值相同：不重复写入。
- 提取失败：不写入，不删除已有历史。
- 页面获取失败：不提取，不更新快照，不写入历史。

数值比较在本期使用严格数值比较 `Object.is(last.value, value)`。因为提取结果为有限的 JavaScript `number`，实现必须拒绝 `NaN` 和正负无穷。

### 5.2 图表展示条件

- 0 个有效点：显示“尚未采集到有效数值”。
- 1 个有效点：显示当前值，并提示“再采集到一个不同数值后显示趋势”。
- 2 个及以上有效点：绘制图表。
- Chart.js 加载或绘制失败：显示“趋势图加载失败”，同时向控制台输出带上下文的错误。

迷你图区域空间有限：0 或 1 个点时不画 canvas，但任务仍应按 `task.numericMode !== 'off'` 被识别为数值任务。详情页必须显示上述状态文案。

### 5.3 历史保留上限

沿用每个任务最多 100 个点的现有行为。添加第 101 个点时删除最早的点。

## 6. 技术设计

### 6.1 Chart.js 加载

继续使用仓库内的 `lib/vendor/chart.umd.min.js`，但移除 fetch、Blob 和 Blob URL。

`content/panel.js` 中的加载器改为：

```js
let Chart;
let chartLoadPromise;

async function ensureChart() {
  if (Chart) return Chart;

  if (!chartLoadPromise) {
    chartLoadPromise = import(
      chrome.runtime.getURL('lib/vendor/chart.umd.min.js')
    ).then(() => {
      const loadedChart = globalThis.Chart;
      if (typeof loadedChart !== 'function') {
        throw new Error('Chart.js UMD loaded without globalThis.Chart');
      }
      Chart = loadedChart;
      return Chart;
    }).catch((error) => {
      chartLoadPromise = undefined;
      throw error;
    });
  }

  return chartLoadPromise;
}
```

约束：

- `chart.umd.min.js` 必须继续声明在 `web_accessible_resources` 中。
- 同一页面并发请求只能触发一次加载。
- 加载失败后允许下一次渲染重试。
- 不向宿主页面注入 `<script>`；Chart.js 必须留在内容脚本隔离世界中。
- 不再宣传“Chart.js Blob URL 规避 CSP”；README 应改为“通过扩展本地资源加载 Chart.js”。

### 6.2 数值提取 API

将 `background/differ.js` 中的 `extractNumericValue()` 改为具名导出，或移动到独立的 `background/numeric.js`。本期推荐新建独立模块，避免采样继续依赖 change record。

建议接口：

```js
export function extractNumericValue(text, task) {
  return {
    ok: boolean,
    value: number | null,
    reason: 'disabled' | 'invalid_regex' | 'no_match' | 'invalid_number' | null
  };
}
```

要求：

- `auto`、`template`、`regex` 保持现有匹配规则，避免本次修复改变用户配置语义。
- 自定义正则优先使用第一个捕获组，没有捕获组时使用完整匹配。
- 无效正则不能抛出到调度器；返回 `invalid_regex`。
- 解析后必须通过 `Number.isFinite(value)` 校验。
- `createChangeRecord()` 接收已经提取好的可选数值结果，或者内部调用同一公共函数；禁止维护两套提取实现。

### 6.3 调度器执行顺序

`background/scheduler.js` 的单任务检查按以下顺序执行：

```text
获取页面内容
  → 限制内容长度
  → 读取旧快照
  → 更新 lastCheckedAt
  → 对当前内容执行数值提取
  → 按去重规则保存数值点
  → 如果没有旧快照：保存初始快照并返回
  → 计算文本 diff
  → 保存新快照
  → 如果没有文本变化：返回
  → 创建变化记录、广播、通知
```

关键约束：

- 数值采样必须发生在 `first_snapshot` 和 `no_change` 的提前返回之前。
- 文本是否变化只决定是否创建 change record、广播和通知，不决定是否保存数值历史。
- change record 中的 `isNumeric` 和 `numericValue` 使用本次已经得到的提取结果。
- 数值写入失败应使本次任务检查失败并记录错误，避免出现“快照已更新但数值点丢失”的静默部分成功。若后续需要更强原子性，再单独设计事务层。

建议新增存储接口：

```js
export async function addNumericPointIfChanged(taskId, value, timestamp) {
  const history = await getNumericHistory(taskId);
  const last = history.at(-1);

  if (last && Object.is(last.value, value)) {
    return { added: false, historyLength: history.length };
  }

  history.push({ value, timestamp });
  // 保留最后 100 个点
  await save(history);
  return { added: true, historyLength: history.length };
}
```

### 6.4 面板状态与渲染

`content/panel.js` 增加统一的数值历史状态判断：

```js
function getNumericHistoryState(history) {
  if (history.length === 0) return 'empty';
  if (history.length === 1) return 'insufficient';
  return 'ready';
}
```

任务列表：

- 使用任务配置 `numericMode !== 'off'` 判断数值任务，不再依赖是否已经产生 numeric change。
- `ready` 时显示迷你图。
- `empty` 或 `insufficient` 时不创建 Chart 实例；可显示当前值或轻量占位符。
- 每次重绘任务列表前销毁仍存活的迷你图实例，避免重复渲染造成 Chart.js “Canvas is already in use”错误和内存泄漏。
- 使用 `Map<taskId, Chart>` 管理迷你图实例。

详情页：

- 为图表区域增加状态文案元素，例如 `#mw-chart-status`。
- `empty`、`insufficient`、`error` 显示状态文案；`ready` 显示 canvas。
- 每次切换记录时先销毁旧趋势图。
- catch 块必须记录任务 ID 和错误：

```js
console.warn(`[MayWatch] Failed to render trend chart for ${taskId}`, error);
```

实时刷新：

- 收到 `CHANGE_DETECTED` 后维持现有列表刷新行为。
- 因为基线采样和无 diff 采样不会发送 `CHANGE_DETECTED`，打开面板或点击“立即检查”后必须重新请求 history。
- 本期不新增 `NUMERIC_POINT_ADDED` 广播；后续若要求面板在无文本 diff 时实时更新，再单独加入该消息。

### 6.5 任务修改和删除的数据生命周期

删除任务时必须同时删除：

- `snapshot:${taskId}`
- `numericHistory:${taskId}`
- 与任务关联的 change records 是否删除维持现状，本期不改变。

编辑任务时，下列任一字段改变必须清空旧快照和旧数值历史，防止不同监控对象或不同提取语义的数据混合：

- `url`
- `selector`
- `selectorType`
- `numericMode`
- `numericTemplate`
- `numericRegex`

仅修改以下字段不清空历史：

- `name`
- `interval`
- `enabled`

实现方式：在 `SAVE_TASK` 处理期间读取旧任务并比较上述字段；发生语义变化时调用统一的 `resetTaskRuntimeData(taskId)`。

### 6.6 兼容与迁移

不进行一次性全量迁移：

- 已存在且格式合法的 `{ value, timestamp }` 历史继续使用。
- 新代码读取历史时过滤非有限数值和无效时间戳；过滤结果在下次写入时持久化。
- 已有任务不自动补写历史基线；升级后的下一次成功检查会按去重规则写入当前值。
- 如果已有历史最后一个点等于当前值，不写重复点。

## 7. 逐文件实施清单

### `background/numeric.js`（新增，推荐）

- 移入数值模板和提取函数。
- 返回结构化结果和失败原因。
- 导出供 scheduler 和 differ 使用。

### `background/differ.js`

- 删除私有的重复提取实现。
- `createChangeRecord()` 使用公共提取结果。
- 保持普通 diff 输出结构不变。

### `background/scheduler.js`

- 在提前返回前执行数值提取和去重写入。
- 将提取结果传给 change record。
- 保持文本变化通知行为不变。

### `background/storage.js`

- 新增 `addNumericPointIfChanged()`。
- 新增 `clearNumericHistory()`。
- 新增 `resetTaskRuntimeData()`。
- 删除任务时清理数值历史。
- 读取历史时校验数据。

### `background/service-worker.js`

- `SAVE_TASK` 时比较旧任务的语义字段并按需重置运行数据。
- 保持 `GET_NUMERIC_HISTORY` 返回协议不变。

### `content/panel.js`

- 用扩展 URL 直接导入 UMD，并读取 `globalThis.Chart`。
- 增加单例加载 Promise 和失败重试。
- 增加图表状态渲染。
- 使用任务配置识别数值任务。
- 管理并销毁迷你图实例。
- 不再静默吞掉图表错误。

### `content/panel.html`

- 在趋势图容器中增加状态文案节点。

### `content/panel.css`

- 增加 empty、insufficient、error 状态样式。
- 保持现有 canvas 高度和整体布局。

### `README.md` 与 `README_CN.md`

- 删除 Blob URL 规避 CSP 的技术描述。
- 明确趋势图在两个有效数值点后显示。
- 说明默认记录首个值及后续不同值，而非每次轮询值。

## 8. 测试方案

### 8.1 数值提取单元测试

至少覆盖：

- auto：整数、负数、小数、千分位、货币符号、百分比。
- template：integer、decimal、with-unit、currency。
- regex：有捕获组、无捕获组、无效正则、无匹配、捕获结果无法转为数值。
- 拒绝 `NaN` 和无穷值。

### 8.2 存储测试

- 空历史添加第一个点。
- 相同值不重复添加。
- 不同值追加。
- 超过 100 点只保留最后 100 点。
- 删除任务清理 snapshot 和 numeric history。
- 语义字段变化清理运行数据，非语义字段变化保留数据。
- 读取时过滤损坏历史项。

### 8.3 调度器测试

| 场景 | 预期历史 | 预期 change record |
|---|---|---|
| 首次检查得到 `100` | `[100]` | 无 |
| 第二次仍为 `100` | `[100]` | 无 |
| 第二次变为 `101` | `[100, 101]` | 有，numericValue 为 101 |
| 文本变化但提取值仍为 `101` | `[100, 101]` | 有，numericValue 为 101 |
| 提取失败 | 不变 | change 可存在但 `isNumeric=false` |
| 页面获取失败 | 不变 | 无 |

### 8.4 面板测试

- 加载 Chart.js 时不产生 CSP 错误。
- 并发调用 `ensureChart()` 只加载一次。
- 0 点显示 empty 文案。
- 1 点显示当前值和 insufficient 文案。
- 2 点显示任务迷你图和详情趋势图。
- 从详情返回列表后销毁趋势图实例。
- 多次展开、收起或刷新任务列表不出现 canvas 重用错误。
- 模拟 Chart.js 加载失败时显示错误状态并允许重试。

### 8.5 手工验收用例

准备一个每次点击按钮数值加 1 的本地测试页：

1. 新建数值任务，目标初始值为 `100`。
2. 执行第一次检查。
3. 确认详情状态显示当前值 100，并提示需要第二个点。
4. 将页面数值改为 `101`，执行第二次检查。
5. 确认任务列表出现迷你图。
6. 点击变化记录，确认详情出现包含 100 和 101 的趋势图。
7. 再次检查且数值保持 101，确认历史点数不增加。
8. 将数值改为 102，确认图表增加第三个点。
9. 重载宿主页和扩展 service worker，确认历史和图表仍可恢复。
10. 删除任务，确认对应 snapshot 和 numeric history 均不存在。

## 9. 验收标准

以下条件全部满足才可关闭问题：

- Chrome 扩展控制台中没有与 `blob:` 或 Chart.js 导入相关的 CSP 错误。
- `ensureChart()` 返回可调用的 Chart 构造器。
- 初始数值会成为历史第一个点。
- 第一次不同数值出现后历史达到两个点并显示图表。
- 相同数值的重复轮询不增加历史点。
- auto、template、regex 三种模式均能生成历史和图表。
- 数据不足与加载失败在 UI 上可区分。
- 删除或语义性编辑任务不会遗留或混用旧数值历史。
- README 描述与最终采样和展示行为一致。

## 10. 实施顺序与提交拆分

建议拆为四个可独立审查的提交：

1. `fix(chart): load bundled Chart.js UMD without blob URL`
2. `fix(numeric): record baseline and deduplicate numeric history`
3. `fix(panel): expose numeric chart states and manage chart lifecycle`
4. `docs(test): align numeric tracking docs and add regression coverage`

## 11. 风险与回滚

- 风险：直接导入 UMD 后全局 `Chart` 可能与同一隔离世界内的其他代码冲突。缓解：只读取扩展隔离世界的 `globalThis.Chart`，并缓存到模块局部变量。
- 风险：历史去重语义与部分用户期待的“每次轮询采样”不同。缓解：README 明确说明记录数值变化；未来可新增 sampling mode。
- 风险：编辑选择器时清空历史可能造成用户数据丢失。该行为是为了避免不同序列混合，保存前应在 UI 中提示“修改监控目标将重置快照与数值历史”。
- 回滚：四个提交应保持边界清晰；若图表加载修复需要单独回滚，不应影响存储格式。现有历史数据结构不变，因此无数据格式回滚步骤。
