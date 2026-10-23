// Keyboard -> 5250 AID keys. Shift+F1..F12 gives F13..F24.

import type { AidName } from '@veneer/tn5250';

export type KeyAction = AidName | 'Reset';

export function keyAction(e: KeyboardEvent): KeyAction | null {
  if (e.altKey || e.metaKey || e.ctrlKey) return null;
  const fk = /^F(\d{1,2})$/.exec(e.key);
  if (fk) {
    const n = Number(fk[1]);
    if (n >= 1 && n <= 12) return `F${e.shiftKey ? n + 12 : n}` as AidName;
    return null;
  }
  switch (e.key) {
    case 'Enter': {
      // Let Enter activate a focused button or link instead.
      const t = e.target as HTMLElement | null;
      return t?.tagName === 'BUTTON' || t?.tagName === 'A' ? null : 'Enter';
    }
    case 'PageUp': return 'PageUp';
    case 'PageDown': return 'PageDown';
    case 'Escape': return 'Reset';
  }
  return null;
}

/** Human label for an AID key, e.g. "Shift+F1" hints are left to the button. */
export function keyHint(aid: AidName): string {
  switch (aid) {
    case 'PageUp': return 'PgUp';
    case 'PageDown': return 'PgDn';
    case 'RecordBackspace': return 'RecBksp';
    default: return aid;
  }
}
