// Link buttons: URL templates filled from the screen. In a template, {6:22}
// is the input field starting at row 6, column 22 (its current value), or
// else the text there, up to the next double space. {6:22:10} takes exactly
// 10 characters. Values are trimmed and URL-encoded.

import type { ScreenSnapshot } from '@veneer/terminal';

const PLACEHOLDER = /\{(\d{1,3}):(\d{1,3})(?::(\d{1,3}))?\}/g;

/** A web address with a fixed host: placeholders may only follow it. */
const WEB_URL = /^https?:\/\/[^\s/?#{}]+/i;

export interface Placeholder {
  row: number;
  col: number;
  length?: number;
}

export function placeholders(template: string): Placeholder[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => ({
    row: Number(m[1]), col: Number(m[2]), ...(m[3] ? { length: Number(m[3]) } : {}),
  }));
}

/** True when the template is an http(s) address whose host is not a placeholder. */
export function isWebTemplate(template: string): boolean {
  return WEB_URL.test(template);
}

/**
 * The value a placeholder stands for. `values` are field edits not yet sent
 * to the host, by field id, which win over the screen.
 */
export function placeholderValue(snap: ScreenSnapshot, p: Placeholder, values: Record<string, string> = {}): string {
  const field = snap.fields.find((f) => f.row === p.row && f.col === p.col);
  if (field) {
    const value = values[field.id] ?? field.value;
    return (p.length ? value.slice(0, p.length) : value).trim();
  }
  const line = snap.lines[p.row - 1] ?? '';
  const rest = line.slice(p.col - 1);
  return (p.length ? rest.slice(0, p.length) : rest.split('  ')[0]!).trim();
}

/** Fill a template from the screen. Undefined unless the result is an http(s) URL. */
export function fillUrl(template: string, snap: ScreenSnapshot, values: Record<string, string> = {}): string | undefined {
  if (!isWebTemplate(template)) return undefined;
  const filled = template.replace(PLACEHOLDER, (_m, row: string, col: string, length?: string) =>
    encodeURIComponent(placeholderValue(snap, { row: Number(row), col: Number(col), ...(length ? { length: Number(length) } : {}) }, values)));
  try {
    const url = new URL(filled);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Fill a template's placeholders from the screen, as plain text (a macro button's parameter values). */
export function fillText(template: string, snap: ScreenSnapshot, values: Record<string, string> = {}): string {
  return template.replace(PLACEHOLDER, (_m, row: string, col: string, length?: string) =>
    placeholderValue(snap, { row: Number(row), col: Number(col), ...(length ? { length: Number(length) } : {}) }, values));
}

const VALUE = /\{value\}/g;

/**
 * A link display's web address: {value} is the text being shown, {row:col}
 * other text on the screen. Undefined unless the result is an http(s) URL.
 */
export function fillLink(template: string, value: string, snap: ScreenSnapshot): string | undefined {
  return fillUrl(template.replace(VALUE, encodeURIComponent(value.trim())), snap);
}

/** A path on this site, such as /images/{6:12}.png (not //host, which is another site). */
const SITE_PATH = /^\/(?![/\\])[^\s\\"'<>]*$/;

export type ImageSource = 'theme' | 'web' | 'site';

/** What kind of image source a definition names, or undefined if it is none (`themeFile`: THEME_FILE). */
export function imageSourceKind(src: string, themeFile: RegExp): ImageSource | undefined {
  if (themeFile.test(src)) return 'theme';
  if (isWebTemplate(src)) return 'web';
  if (SITE_PATH.test(src) && !src.split(/[/?#]/).includes('..')) return 'site';
  return undefined;
}

/**
 * The address of an image: a theme image under `themeBase` (the theme in
 * use), or a web address or site path with {row:col} filled from the screen
 * (each value URL-encoded, so it can't add path segments). Undefined when
 * the address can't be made.
 */
export function imageUrl(src: string, snap: ScreenSnapshot, themeFile: RegExp, themeBase: string | undefined): string | undefined {
  switch (imageSourceKind(src, themeFile)) {
    case 'theme': return themeBase ? `${themeBase}${encodeURIComponent(src)}` : undefined;
    case 'web': return fillUrl(src, snap);
    case 'site': return src.replace(PLACEHOLDER, (_m, row: string, col: string, length?: string) =>
      encodeURIComponent(placeholderValue(snap, { row: Number(row), col: Number(col), ...(length ? { length: Number(length) } : {}) })));
    default: return undefined;
  }
}
