/**
 * Shared metric-simulation engine for the MayWatch demo pages.
 * Frameworks (vanilla/React/Vue) all drive the SAME numeric model so the
 * extension sees identical selectors & value formats regardless of stack.
 *
 * Each metric exposes a stable id used as the CSS selector in the panel:
 *   #online-count (integer) #latency (ms) #cpu (%) #load (decimal)
 *   #price (currency)       #stock (integer, placeholder-on-reload)
 */
export function createMetricModel() {
  return {
    online: 5230,
    latency: 120,
    cpu: 38,
    load: 1.42,
    price: 89.9,
    stock: 240,
  };
}

const rnd = (n) => Math.round(n);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Advance the model one tick; returns a fresh object (immutable-friendly for React). */
export function tickMetrics(m) {
  return {
    online: clamp(m.online + rnd((Math.random() - 0.45) * 60), 4000, 9999),
    latency: clamp(m.latency + rnd((Math.random() - 0.5) * 40), 30, 800),
    cpu: clamp(m.cpu + rnd((Math.random() - 0.5) * 14), 2, 99),
    load: clamp(+(m.load + (Math.random() - 0.5) * 0.6).toFixed(2), 0.1, 9.99),
    price: clamp(+(m.price + (Math.random() - 0.5) * 4).toFixed(1), 9.9, 199.9),
    stock: clamp(m.stock + rnd((Math.random() - 0.55) * 18), 0, 999),
  };
}

/** Human-formatted strings exactly as they should render in the DOM. */
export function formatMetrics(m) {
  return {
    online: String(m.online),
    latency: `${m.latency}ms`,
    cpu: `${m.cpu}%`,
    load: m.load.toFixed(2),
    price: `¥${m.price.toFixed(1)}`,
    stock: String(m.stock),
  };
}

export const METRIC_META = [
  { key: 'online', id: 'online-count', label: '在线人数', sel: '#online-count · 整数/自动' },
  { key: 'latency', id: 'latency', label: '响应延迟', sel: '#latency · 带单位 / (\\d+)ms' },
  { key: 'cpu', id: 'cpu', label: 'CPU 使用率', sel: '#cpu · 带单位 (%)' },
  { key: 'load', id: 'load', label: '系统负载', sel: '#load · 小数' },
  { key: 'price', id: 'price', label: '商品价格', sel: '#price · 货币' },
  { key: 'stock', id: 'stock', label: '库存 (刷新占位)', sel: '#stock · 整数, 刷新先显示 —' },
];

/** Keys that should briefly show a placeholder right after (re)load. */
export const PLACEHOLDER_KEYS = ['stock'];
export const PLACEHOLDER_TEXT = '—';
export const RELOAD_FILL_DELAY_MS = 1500;
export const TICK_MS = 3000;
