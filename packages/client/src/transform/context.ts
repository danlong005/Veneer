// Shared state for transform rules: the snapshot split into text chunks,
// and a claim map so each screen cell is rendered by exactly one item.

import type { DisplayAttribute, FieldSnapshot, ScreenSnapshot } from '@veneer/tn5250';
import type { Role, ScreenView } from './types.ts';

/** A run of same-styled text, split wherever there are two or more spaces. */
export interface Chunk {
  row: number;
  col: number;
  /** Exclusive end column. */
  end: number;
  text: string;
  attr: DisplayAttribute;
}

export function roleOf(attr: DisplayAttribute): Role {
  switch (attr.color) {
    case 'white': return 'emphasis';
    case 'blue': return 'muted';
    case 'red': return 'danger';
    case 'yellow': return 'warning';
    case 'turquoise': return 'accent';
    case 'pink': return 'accent2';
    default: return 'normal';
  }
}

export class TransformContext {
  readonly snap: ScreenSnapshot;
  readonly view: ScreenView;
  /** Input (non-bypass) fields; bypass fields render as text. */
  readonly inputs: FieldSnapshot[];
  private readonly claimed: Uint8Array;
  private readonly chunksByRow: Chunk[][];

  constructor(snap: ScreenSnapshot) {
    this.snap = snap;
    this.view = { rows: snap.rows, cols: snap.cols, meta: [], items: [], functionKeys: [], snapshot: snap };
    this.inputs = snap.fields.filter((f) => !f.bypass);
    this.claimed = new Uint8Array(snap.rows * snap.cols);
    const inField = new Uint8Array(snap.rows * snap.cols);
    for (const f of this.inputs) {
      const start = (f.row - 1) * snap.cols + (f.col - 1);
      inField.fill(1, Math.max(0, start - 1), Math.min(inField.length, start + f.length));
    }
    this.chunksByRow = snap.segments.map((segs, r) => splitRow(r + 1, segs, inField, snap.cols));
  }

  private index(row: number, col: number): number {
    return (row - 1) * this.snap.cols + (col - 1);
  }

  isClaimed(row: number, col: number): boolean {
    return this.claimed[this.index(row, col)] === 1;
  }

  claim(row: number, col: number, width: number): void {
    const start = this.index(row, col);
    this.claimed.fill(1, start, Math.min(this.claimed.length, start + width));
  }

  claimRow(row: number, fromCol = 1): void {
    this.claim(row, fromCol, this.snap.cols - fromCol + 1);
  }

  claimField(f: FieldSnapshot): void {
    // Fields can wrap onto following rows; claim() works on linear addresses.
    this.claim(f.row, f.col, f.length);
  }

  isFieldClaimed(f: FieldSnapshot): boolean {
    return this.isClaimed(f.row, f.col);
  }

  /** Unclaimed text chunks on a row, left to right. */
  chunks(row: number): Chunk[] {
    return (this.chunksByRow[row - 1] ?? []).filter((c) => !this.isClaimed(c.row, c.col));
  }

  /** Unclaimed input fields starting on a row. */
  fieldsOn(row: number): FieldSnapshot[] {
    return this.inputs.filter((f) => f.row === row && !this.isFieldClaimed(f));
  }

  /** Text of a row between two columns (inclusive start, exclusive end), field cells blanked. */
  slice(row: number, col: number, end: number): string {
    let s = '';
    for (const c of this.chunksByRow[row - 1] ?? []) {
      if (c.end <= col || c.col >= end) continue;
      const pad = Math.max(0, c.col - col - s.length);
      s += ' '.repeat(pad) + c.text.slice(Math.max(0, col - c.col), end - c.col);
    }
    return s.trim();
  }
}

function splitRow(row: number, segs: ScreenSnapshot['segments'][number], inField: Uint8Array, cols: number): Chunk[] {
  const chunks: Chunk[] = [];
  for (const seg of segs) {
    if (seg.attr.nonDisplay) continue;
    // Break the segment wherever it overlaps an input field.
    let runStart = -1;
    const flush = (endIdx: number) => {
      if (runStart < 0) return;
      const text = seg.text.slice(runStart, endIdx);
      const re = /\S+(?: \S+)*/g;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        const col = seg.col + runStart + m.index;
        chunks.push({ row, col, end: col + m[0].length, text: m[0], attr: seg.attr });
      }
      runStart = -1;
    };
    for (let i = 0; i < seg.text.length; i++) {
      const covered = inField[(row - 1) * cols + (seg.col - 1 + i)] === 1;
      if (covered) flush(i);
      else if (runStart < 0) runStart = i;
    }
    flush(seg.text.length);
  }
  return chunks;
}
