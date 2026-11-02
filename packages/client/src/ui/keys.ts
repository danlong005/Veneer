// Keyboard -> host keys. Shift+F1..F12 gives F13..F24 (PF13-PF24 on a 3270).
//
// On a 3270, Page Up and Page Down send the keys the server names (usually
// PF7 and PF8; the server maps them), Pause is Clear, End is Erase EOF and
// Insert switches between inserting and typing over.

import type { AidName, HostType } from '@veneer/terminal';
import type { TypedKey } from './typeahead.ts';

/** What the browser does locally on a 3270, without the host. */
export type LocalKey =
  /** Blank the field from the caret to its end. */
  | 'EraseEOF'
  /** Blank every input field. */
  | 'EraseInput'
  /** Switch between inserting and typing over. */
  | 'Insert';

export type KeyAction = AidName | 'Reset' | LocalKey;

/** What Page Up and Page Down send on this host, from /api/config; null when nothing. */
export interface PageKeys {
  up: AidName;
  down: AidName;
}

export interface KeyContext {
  host: HostType;
  /** Whether Page Up and Page Down do anything (always on a 5250). */
  paging: boolean;
}

const IBM_I: KeyContext = { host: '5250', paging: true };

export function keyAction(e: KeyboardEvent, ctx: KeyContext = IBM_I): KeyAction | null {
  if (e.altKey || e.metaKey || e.ctrlKey) return null;
  const fk = /^F(\d{1,2})$/.exec(e.key);
  if (fk) {
    const n = Number(fk[1]);
    if (n >= 1 && n <= 12) return `F${e.shiftKey ? n + 12 : n}` as AidName;
    return null;
  }
  switch (e.key) {
    case 'Enter': {
      // Let Enter activate a focused button or link instead, or start a new line in a text area.
      const t = e.target as HTMLElement | null;
      return t?.tagName === 'BUTTON' || t?.tagName === 'A' || t?.tagName === 'TEXTAREA' ? null : 'Enter';
    }
    case 'PageUp': return ctx.paging ? 'PageUp' : null;
    case 'PageDown': return ctx.paging ? 'PageDown' : null;
    case 'Escape': return 'Reset';
  }
  if (ctx.host !== '3270') return null;
  switch (e.key) {
    case 'Pause': return 'Clear';
    case 'End': {
      // Erase EOF in a field; elsewhere (a button, the page) End keeps its usual meaning.
      const t = e.target as HTMLElement | null;
      return t?.tagName === 'INPUT' && (t as HTMLInputElement).dataset?.field ? 'EraseEOF' : null;
    }
    case 'Insert': return 'Insert';
  }
  return null;
}

/** A local key, not one that goes to the host. */
export const isLocalKey = (a: KeyAction): a is LocalKey => a === 'EraseEOF' || a === 'EraseInput' || a === 'Insert';

/** The label of a host key: PF3 on a 3270, F3 on a 5250. */
export function keyHint(aid: AidName, host: HostType = '5250'): string {
  if (host === '3270' && /^F\d+$/.test(aid)) return `P${aid}`;
  switch (aid) {
    case 'PageUp': return 'PgUp';
    case 'PageDown': return 'PgDn';
    case 'RecordBackspace': return 'RecBksp';
    default: return aid;
  }
}

const F_KEYS = Array.from({ length: 24 }, (_, i) => `F${i + 1}` as AidName);

/** Every key a 3270 can send, for its Keys menu. */
export const KEYS_3270: AidName[] = [...F_KEYS, 'PA1', 'PA2', 'PA3', 'Clear'];

/** The keys a designer's button can press on a host: a 3270 has PA keys and Clear, a 5250 Help, Print and page keys. */
export function buttonAids(host: HostType): AidName[] {
  return host === '3270' ? ['Enter', ...F_KEYS, 'PA1', 'PA2', 'PA3', 'Clear'] : ['Enter', 'PageUp', 'PageDown', 'Help', 'Print', ...F_KEYS];
}

/** A keystroke to queue while the host is busy, or null to ignore it. */
export function typedKey(e: KeyboardEvent, ctx: KeyContext = IBM_I): TypedKey | null {
  if (e.altKey || e.metaKey || e.ctrlKey) return null;
  const action = keyAction(e, ctx);
  if (action === 'Reset' || (action && isLocalKey(action))) return null;
  if (action) return { kind: 'aid', aid: action };
  if (e.key === 'Tab') return { kind: 'tab', back: e.shiftKey };
  if (e.key === 'Backspace') return { kind: 'backspace' };
  if (e.key.length === 1) return { kind: 'char', ch: e.key };
  return null;
}
