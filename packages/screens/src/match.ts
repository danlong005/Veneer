// Screen identification: a definition matches when all its text appears at
// the stated positions. With several matches, the most specific one wins.

import type { ScreenSnapshot } from '@veneer/tn5250';
import type { ScreenDefinition, TextMatch } from './types.ts';

export function textMatches(snap: ScreenSnapshot, m: TextMatch): boolean {
  const line = snap.lines[m.row - 1];
  if (line === undefined || m.text.length === 0) return false;
  return line.slice(m.col - 1, m.col - 1 + m.text.length) === m.text;
}

export function matches(snap: ScreenSnapshot, def: ScreenDefinition): boolean {
  const { rows, cols, text } = def.match;
  if (rows !== undefined && rows !== snap.rows) return false;
  if (cols !== undefined && cols !== snap.cols) return false;
  return text.length > 0 && text.every((m) => textMatches(snap, m));
}

/** Specificity: more conditions first, then more matched characters. */
function score(def: ScreenDefinition): number {
  const chars = def.match.text.reduce((n, m) => n + m.text.length, 0);
  return def.match.text.length * 10_000 + chars;
}

export function matchScreen(snap: ScreenSnapshot, defs: readonly ScreenDefinition[]): ScreenDefinition | undefined {
  let best: ScreenDefinition | undefined;
  for (const def of defs) {
    if (matches(snap, def) && (!best || score(def) > score(best))) best = def;
  }
  return best;
}
