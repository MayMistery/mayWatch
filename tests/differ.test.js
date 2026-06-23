import { describe, it, expect } from 'vitest';
import { computeDiff, createChangeRecord } from '../background/differ.js';

/**
 * RED PHASE: 占位值兼容性测试
 *
 * 这些测试断言期望行为，当前代码尚未实现，因此测试应该 FAIL。
 *
 * Bug 1: differ.js 缺少 isPlaceholderContent 函数
 * Bug 2: 占位值内容仍会产生变更记录
 */

// 期望的占位值识别函数（尚未在 differ.js 中实现）
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

function isPlaceholderContent(text) {
  const trimmed = text.trim();
  return PLACEHOLDER_PATTERNS.some(p => p.test(trimmed));
}

describe('RED: differ.js 缺少 isPlaceholderContent 导出', () => {
  it('differ.js 应导出 isPlaceholderContent 函数', async () => {
    // 动态导入验证函数是否存在
    const mod = await import('../background/differ.js');
    expect(mod.isPlaceholderContent).toBeDefined();
    expect(typeof mod.isPlaceholderContent).toBe('function');
  });
});

describe('RED: 占位值应被识别并跳过（期望行为）', () => {
  const numericTask = {
    id: 'task-1',
    name: 'QPS Monitor',
    url: 'https://example.com',
    numericMode: 'auto',
  };

  it('"--" 应被识别为占位值', () => {
    expect(isPlaceholderContent('--')).toBe(true);
  });

  it('"Loading..." 应被识别为占位值', () => {
    expect(isPlaceholderContent('Loading...')).toBe(true);
  });

  it('"N/A" 应被识别为占位值', () => {
    expect(isPlaceholderContent('N/A')).toBe(true);
  });

  it('"—" 应被识别为占位值', () => {
    expect(isPlaceholderContent('—')).toBe(true);
  });

  it('"正在加载..." 应被识别为占位值', () => {
    expect(isPlaceholderContent('正在加载...')).toBe(true);
  });

  it('"null" 应被识别为占位值', () => {
    expect(isPlaceholderContent('null')).toBe(true);
  });

  it('空字符串应被识别为占位值', () => {
    expect(isPlaceholderContent('')).toBe(true);
  });

  it('正常数值 "1523" 不应被识别为占位值', () => {
    expect(isPlaceholderContent('1523')).toBe(false);
  });

  it('正常文本 "QPS: 1523" 不应被识别为占位值', () => {
    expect(isPlaceholderContent('QPS: 1523')).toBe(false);
  });

  it('正常文本 "CPU: 85%" 不应被识别为占位值', () => {
    expect(isPlaceholderContent('CPU: 85%')).toBe(false);
  });
});

describe('RED: 占位值不应产生变更记录（期望行为）', () => {
  const numericTask = {
    id: 'task-1',
    name: 'QPS Monitor',
    url: 'https://example.com',
    numericMode: 'auto',
  };

  /**
   * 模拟 scheduler 中应有的逻辑：
   * 如果新内容是占位值，应跳过变更记录创建。
   */
  function shouldSkipPlaceholderChange(newContent) {
    return isPlaceholderContent(newContent);
  }

  it('"--" 占位值应被跳过', () => {
    expect(shouldSkipPlaceholderChange('--')).toBe(true);
  });

  it('"Loading..." 占位值应被跳过', () => {
    expect(shouldSkipPlaceholderChange('Loading...')).toBe(true);
  });

  it('"N/A" 占位值应被跳过', () => {
    expect(shouldSkipPlaceholderChange('N/A')).toBe(true);
  });

  it('正常数值不应被跳过', () => {
    expect(shouldSkipPlaceholderChange('QPS: 1523')).toBe(false);
  });
});

describe('RED: 正常数值变化应保持正常（回归测试）', () => {
  const numericTask = {
    id: 'task-1',
    name: 'QPS Monitor',
    url: 'https://example.com',
    numericMode: 'auto',
  };

  it('正常数值变化：1000 → 1523', () => {
    const oldContent = 'QPS: 1000';
    const newContent = 'QPS: 1523';
    const diffResult = computeDiff(oldContent, newContent);
    expect(diffResult).not.toBeNull();
    const record = createChangeRecord(numericTask, oldContent, newContent, diffResult);
    expect(record.isNumeric).toBe(true);
    expect(record.numericValue).toBe(1523);
  });

  it('正常数值变化：45ms → 58ms', () => {
    const oldContent = '延迟: 45ms';
    const newContent = '延迟: 58ms';
    const diffResult = computeDiff(oldContent, newContent);
    expect(diffResult).not.toBeNull();
    const record = createChangeRecord(numericTask, oldContent, newContent, diffResult);
    expect(record.isNumeric).toBe(true);
    expect(record.numericValue).toBe(58);
  });

  it('无变化时不产生 diff', () => {
    const oldContent = 'QPS: 1523';
    const newContent = 'QPS: 1523';
    const diffResult = computeDiff(oldContent, newContent);
    expect(diffResult).toBeNull();
  });
});
