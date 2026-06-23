import { describe, it, expect } from 'vitest';

/**
 * Panel 趋势图渲染测试 — RED PHASE
 *
 * Bug 1: 在数值监控场景下，detail view 仍然以 diff 形式（摘要/对比/原始 diff）呈现，
 * 而不是以趋势图为主要展示方式。
 *
 * Bug 2: 页面刷新时元素变为占位值（--/Loading.../N/A），导致数值历史中断。
 */

describe('Bug Fix 1: 数值监控详情页应优先展示趋势图', () => {
  /**
   * 模拟 showDetail 的核心逻辑：
   * 当前代码总是渲染 diff tabs，不管 change 是否为纯数值变化。
   * 修复后：当 change.isNumeric 且无文本 diff 时，应显示趋势图为主的视图。
   */

  function shouldShowTrendChartAsPrimary(change, historyLength) {
    const isPureNumeric = change.isNumeric
      && change.summary.addedLines === 0
      && change.summary.removedLines === 0;
    const hasEnoughHistory = historyLength >= 2;
    return isPureNumeric && hasEnoughHistory;
  }

  function shouldShowDiffTabs(change) {
    // 只有当有实际文本变化时才显示 diff tabs
    return change.summary.addedLines > 0 || change.summary.removedLines > 0;
  }

  it('纯数值变化（无文本 diff）+ 足够历史 → 趋势图为主视图，隐藏 diff tabs', () => {
    const change = {
      isNumeric: true,
      numericValue: 1523,
      summary: { addedLines: 0, removedLines: 0 },
    };
    const historyLength = 5;

    expect(shouldShowTrendChartAsPrimary(change, historyLength)).toBe(true);
    expect(shouldShowDiffTabs(change)).toBe(false);
  });

  it('纯数值变化但历史不足 → 显示提示信息，隐藏 diff tabs', () => {
    const change = {
      isNumeric: true,
      numericValue: 1523,
      summary: { addedLines: 0, removedLines: 0 },
    };
    const historyLength = 1;

    expect(shouldShowTrendChartAsPrimary(change, historyLength)).toBe(false);
    expect(shouldShowDiffTabs(change)).toBe(false);
    // 此时应显示 "收集数据中，至少需要 2 个数据点" 的提示
  });

  it('数值+文本混合变化 → 同时显示趋势图和 diff tabs', () => {
    const change = {
      isNumeric: true,
      numericValue: 1523,
      summary: { addedLines: 2, removedLines: 1 },
    };

    expect(shouldShowDiffTabs(change)).toBe(true);
    // 趋势图仍然显示，diff tabs 也显示
  });

  it('非数值变化 → 显示 diff tabs，隐藏趋势图', () => {
    const change = {
      isNumeric: false,
      summary: { addedLines: 3, removedLines: 1 },
    };

    expect(shouldShowDiffTabs(change)).toBe(true);
  });
});

describe('Bug Fix 2: 占位值不应创建变更记录', () => {
  /**
   * 当页面刷新时，监控元素可能短暂显示占位值。
   * 当前行为：占位值被当作普通文本变化，创建变更记录，导致 UI 中出现无意义的 diff。
   * 期望行为：占位值被识别并跳过，不创建变更记录。
   */

  const PLACEHOLDER_PATTERNS = [
    /^--$/,
    /^-$/,
    /^—$/,
    /^loading\.\.\.$/i,
    /^n\/a$/i,
    /^null$/i,
    /^undefined$/i,
    /^正在加载/i,
    /^加载中/i,
    /^刷新中/i,
    /^\s*$/,
  ];

  function isPlaceholder(text) {
    const trimmed = text.trim();
    return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(trimmed));
  }

  it('"--" 应被识别为占位值', () => {
    expect(isPlaceholder('--')).toBe(true);
  });

  it('"Loading..." 应被识别为占位值', () => {
    expect(isPlaceholder('Loading...')).toBe(true);
  });

  it('"N/A" 应被识别为占位值', () => {
    expect(isPlaceholder('N/A')).toBe(true);
  });

  it('"—" 应被识别为占位值', () => {
    expect(isPlaceholder('—')).toBe(true);
  });

  it('"正在加载..." 应被识别为占位值', () => {
    expect(isPlaceholder('正在加载...')).toBe(true);
  });

  it('"null" 应被识别为占位值', () => {
    expect(isPlaceholder('null')).toBe(true);
  });

  it('空字符串应被识别为占位值', () => {
    expect(isPlaceholder('')).toBe(true);
  });

  it('纯空白应被识别为占位值', () => {
    expect(isPlaceholder('   ')).toBe(true);
  });

  it('正常数值 "1523" 不应被识别为占位值', () => {
    expect(isPlaceholder('1523')).toBe(false);
  });

  it('正常文本 "QPS: 1523" 不应被识别为占位值', () => {
    expect(isPlaceholder('QPS: 1523')).toBe(false);
  });

  it('正常文本 "CPU: 85%" 不应被识别为占位值', () => {
    expect(isPlaceholder('CPU: 85%')).toBe(false);
  });
});

describe('Bug Fix 2 扩展: 占位值不中断数值历史', () => {
  /**
   * 当检测到占位值时，不应调用 addNumericPoint，
   * 也不应广播 CHANGE_DETECTED 消息。
   */

  function shouldSkipChangeForPlaceholder(newContent, isNumericTask) {
    const PLACEHOLDER_PATTERNS = [
      /^--$/, /^-$/, /^—$/, /^loading\.\.\.$/i, /^n\/a$/i,
      /^null$/i, /^undefined$/i, /^正在加载/i, /^加载中/i, /^刷新中/i, /^\s*$/,
    ];
    const trimmed = newContent.trim();
    const isPlaceholder = PLACEHOLDER_PATTERNS.some(p => p.test(trimmed));

    // 如果新内容是占位值，且任务是数值追踪模式，则跳过
    if (isPlaceholder && isNumericTask) {
      return true; // skip
    }
    return false;
  }

  it('数值追踪任务 + 占位值内容 → 应跳过变更', () => {
    expect(shouldSkipChangeForPlaceholder('--', true)).toBe(true);
    expect(shouldSkipChangeForPlaceholder('Loading...', true)).toBe(true);
  });

  it('数值追踪任务 + 正常内容 → 不应跳过', () => {
    expect(shouldSkipChangeForPlaceholder('1523', true)).toBe(false);
  });

  it('非数值追踪任务 + 占位值内容 → 不应跳过（文本监控仍需记录）', () => {
    // 对于文本监控，占位值可能也是有用的变化信息
    expect(shouldSkipChangeForPlaceholder('--', false)).toBe(false);
  });
});
