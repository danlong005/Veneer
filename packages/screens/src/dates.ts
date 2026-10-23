// Converting between host date formats and ISO dates (YYYY-MM-DD) for date pickers.

import type { DateFormat } from './types.ts';

/** Host value -> ISO date, or '' when the value is empty or not a valid date. */
export function hostToIso(value: string, format: DateFormat): string {
  const v = value.trim();
  if (v.length !== format.length) return '';
  let y = '', m = '', d = '';
  for (let i = 0; i < format.length; i++) {
    const f = format[i]!, c = v[i]!;
    if (f === 'Y') y += c;
    else if (f === 'M') m += c;
    else if (f === 'D') d += c;
    else if (c !== f) return '';
  }
  if (!/^\d+$/.test(y + m + d)) return '';
  // Two-digit years: 40-99 -> 19xx, 00-39 -> 20xx (the IBM i *YMD window).
  const year = y.length === 2 ? (Number(y) >= 40 ? `19${y}` : `20${y}`) : y;
  const iso = `${year}-${m}-${d}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? '' : iso;
}

/** ISO date -> host value in the given format ('' stays ''). */
export function isoToHost(iso: string, format: DateFormat): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  const [, year, month, day] = m as unknown as [string, string, string, string];
  let yi = 0, mi = 0, di = 0;
  const yearDigits = format.split('Y').length - 1;
  const y = yearDigits === 2 ? year.slice(2) : year;
  return [...format].map((f) => (f === 'Y' ? y[yi++] : f === 'M' ? month[mi++] : f === 'D' ? day[di++] : f)).join('');
}
