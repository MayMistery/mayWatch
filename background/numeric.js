const NUMERIC_TEMPLATES = {
  integer: /(-?\d[\d,]*)/,
  decimal: /(-?[\d,]+\.?\d*)/,
  'with-unit': /(-?[\d,]+\.?\d*)\s*[a-zA-Z%°]+/,
  currency: /[¥$€£₹]\s*([\d,]+\.?\d*)/,
};

export function extractNumericValue(text, task = {}) {
  const mode = task.numericMode || 'off';

  if (mode === 'off') {
    return { ok: false, value: null, reason: 'disabled' };
  }

  let regex;
  if (mode === 'regex' && task.numericRegex) {
    try {
      regex = new RegExp(task.numericRegex);
    } catch {
      return { ok: false, value: null, reason: 'invalid_regex' };
    }
  } else if (mode === 'template') {
    regex = NUMERIC_TEMPLATES[task.numericTemplate] || NUMERIC_TEMPLATES['with-unit'];
  } else {
    regex = /(-?[¥$€£₹]?\s*[\d,]+\.?\d*)\s*[a-zA-Z%°]*/;
  }

  const match = String(text ?? '').match(regex);
  if (!match) {
    return { ok: false, value: null, reason: 'no_match' };
  }

  const captured = match[1] || match[0];
  const stripped = captured.replace(/[¥$€£₹\s,]/g, '');
  const value = Number.parseFloat(stripped);
  if (!Number.isFinite(value)) {
    return { ok: false, value: null, reason: 'invalid_number' };
  }

  return { ok: true, value, reason: null };
}
