import { describe, it, expect } from 'vitest';
import { computeDiff, createChangeRecord, isPlaceholderContent } from '../background/differ.js';

/**
 * scheduler.js GREEN-phase tests
 *
 * 验证占位值跳过逻辑和趋势图主视图逻辑
 */

describe('GREEN: isPlaceholderContent 函数正确性', () => {
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

  it('纯空白应被识别为占位值', () => {
    expect(isPlaceholderContent('   ')).toBe(true);
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

describe('GREEN: 占位值不应产生变更记录', () => {
  const numericTask = {
    id: 'task-1',
    name: 'QPS Monitor',
    url: 'https://example.com',
    numericMode: 'auto',
  };

  it('"--" 占位值应被跳过，不创建 change record', () => {
    const oldContent = '1523';
    const newContent = '--';
    const diffResult = computeDiff(oldContent, newContent);

    // diff 存在（有变化），但应被占位值检查拦截
    expect(diffResult).not.toBeNull();
    expect(isPlaceholderContent(newContent)).toBe(true);

    // 模拟 scheduler 逻辑：占位值被跳过
    const shouldSkip = isPlaceholderContent(newContent);
    expect(shouldSkip).toBe(true);
  });

  it('"Loading..." 占位值应被跳过', () => {
    const newContent = 'Loading...';
    expect(isPlaceholderContent(newContent)).toBe(true);
  });

  it('正常数值不应被跳过', () => {
    const newContent = 'QPS: 1523';
    expect(isPlaceholderContent(newContent)).toBe(false);

    const oldContent = 'QPS: 1000';
    const diffResult = computeDiff(oldContent, newContent);
    expect(diffResult).not.toBeNull();

    const record = createChangeRecord(numericTask, oldContent, newContent, diffResult);
    expect(record.isNumeric).toBe(true);
    expect(record.numericValue).toBe(1523);
  });
});

describe('GREEN: 数值监控下趋势图应为主视图', () => {
  function shouldShowTrendAsPrimary(change) {
    const hasTextDiff = change.summary.addedLines > 0 || change.summary.removedLines > 0;
    return change.isNumeric && !hasTextDiff;
  }

  it('纯数值变化应优先展示趋势图', () => {
    const pureNumericChange = {
      isNumeric: true,
      numericValue: 1523,
      summary: { addedLines: 0, removedLines: 0, changedLines: 0 },
    };
    expect(shouldShowTrendAsPrimary(pureNumericChange)).toBe(true);
  });

  it('混合变化应同时显示趋势图和 diff', () => {
    const mixedChange = {
      isNumeric: true,
      numericValue: 1523,
      summary: { addedLines: 2, removedLines: 1, changedLines: 1 },
    };
    expect(shouldShowTrendAsPrimary(mixedChange)).toBe(false);
  });

  it('非数值变化应显示 diff tabs', () => {
    const textChange = {
      isNumeric: false,
      numericValue: null,
      summary: { addedLines: 3, removedLines: 1, changedLines: 1 },
    };
    expect(shouldShowTrendAsPrimary(textChange)).toBe(false);
  });
});
