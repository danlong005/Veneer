// Finds pop-up windows drawn with character borders. IBM i draws DDS and
// UIM windows this way for displays without enhanced UI support:
//
//    ........ Title .........      top: '.' fill, optional title
//    :                      :      sides: ':'
//    :......................:      bottom: ':' corners, '.' fill

import type { ScreenSnapshot } from '@veneer/tn5250';

/** A rectangle of the screen, 1-based and inclusive. */
export interface Region {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface WindowBox {
  /** The border, 1-based and inclusive. */
  outer: Region;
  title?: string;
}

const BOTTOM = /:\.{6,}:/g;

export function findWindows(snap: ScreenSnapshot): WindowBox[] {
  const boxes: WindowBox[] = [];
  for (let bottom = 3; bottom <= snap.rows; bottom++) {
    for (const m of snap.lines[bottom - 1]!.matchAll(BOTTOM)) {
      const left = m.index + 1;
      const right = left + m[0].length - 1;
      const box = walkUp(snap, bottom, left, right);
      if (box) boxes.push(box);
    }
  }
  return boxes;
}

function walkUp(snap: ScreenSnapshot, bottom: number, left: number, right: number): WindowBox | undefined {
  for (let row = bottom - 1; row >= 1; row--) {
    const line = snap.lines[row - 1]!;
    const a = line[left - 1], b = line[right - 1];
    if (a === '.' && b === '.') {
      const border = line.slice(left - 1, right);
      if (!/^\.{3,}/.test(border) || !/\.{3,}$/.test(border)) return undefined;
      if (bottom - row < 2) return undefined;
      const title = border.replace(/\.+/g, ' ').trim();
      return { outer: { top: row, left, bottom, right }, ...(title ? { title } : {}) };
    }
    if (a !== ':' || b !== ':') return undefined;
  }
  return undefined;
}

/** The window the user is working in: the one holding the cursor, else the last found. */
export function activeWindow(snap: ScreenSnapshot, boxes: WindowBox[]): WindowBox | undefined {
  const { row, col } = snap.cursor;
  const inside = boxes.filter(({ outer: o }) => row > o.top && row < o.bottom && col > o.left && col < o.right);
  const pool = inside.length > 0 ? inside : boxes;
  // Prefer the innermost (smallest) window.
  return [...pool].sort((x, y) => area(x.outer) - area(y.outer))[0];
}

function area(r: Region): number {
  return (r.bottom - r.top + 1) * (r.right - r.left + 1);
}
