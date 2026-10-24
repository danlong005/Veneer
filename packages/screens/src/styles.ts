// Conditional styling: tests a style rule's condition against text from the
// screen. Text tests ignore case and surrounding spaces; number tests read
// 5250-style numbers such as "1,234.50-" or "-12,50".

import type { StyleCondition } from './types.ts';

export const STYLE_TESTS = ['equals', 'contains', 'matches', 'lessThan', 'greaterThan'] as const;
export type StyleTest = (typeof STYLE_TESTS)[number];

/** The condition's test and the value it compares with. */
export function testOf(when: StyleCondition): { test: StyleTest; value: string | number } {
  for (const test of STYLE_TESTS) {
    const value = when[test];
    if (value !== undefined) return { test, value };
  }
  throw new Error('style condition has no test');
}

/** Compiled so a rule is not re-parsed for every table row. */
export function conditionTester(when: StyleCondition): (text: string) => boolean {
  const { test, value } = testOf(when);
  switch (test) {
    case 'equals': {
      const want = String(value).trim().toLowerCase();
      return (text) => text.trim().toLowerCase() === want;
    }
    case 'contains': {
      const want = String(value).trim().toLowerCase();
      return (text) => text.toLowerCase().includes(want);
    }
    case 'matches': {
      const re = new RegExp(String(value), 'i');
      return (text) => re.test(text.trim());
    }
    case 'lessThan':
    case 'greaterThan': {
      const limit = Number(value);
      return (text) => {
        const n = parseNumber(text);
        return n !== undefined && (test === 'lessThan' ? n < limit : n > limit);
      };
    }
  }
}

/**
 * A number as shown on a 5250 screen: an optional sign before or after
 * ("-12.50", "12.50-", "12.50 CR"), with "." or "," as the decimal separator.
 * With both, the last one is the decimal separator; with one, it is a
 * thousands separator only when exactly three digits follow each use of it.
 */
export function parseNumber(text: string): number | undefined {
  let s = text.trim().toUpperCase().replace(/\s+/g, '');
  if (s === '') return undefined;
  let negative = false;
  if (/^-|-$|CR$/.test(s)) {
    negative = true;
    s = s.replace(/^-|-$|CR$/, '');
  } else {
    s = s.replace(/^\+|\+$/, '');
  }
  if (!/^[0-9.,]*[0-9][0-9.,]*$/.test(s)) return undefined;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  let decimal: string | undefined;
  if (lastDot >= 0 && lastComma >= 0) decimal = lastDot > lastComma ? '.' : ',';
  else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const groups = s.split(sep).slice(1);
    decimal = groups.length === 1 && groups[0]!.length !== 3 ? sep : groups.every((g) => g.length === 3) ? undefined : sep;
  }
  const thousands = decimal === '.' ? ',' : decimal === ',' ? '.' : /[.,]/.exec(s)?.[0];
  if (thousands) s = s.split(thousands).join('');
  if (decimal) s = s.replace(decimal, '.');
  if ((s.match(/\./g)?.length ?? 0) > 1) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return negative ? -n : n;
}
