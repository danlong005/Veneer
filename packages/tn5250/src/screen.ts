// The 5250 display: a character buffer plus the format table (input fields).
// Field data lives in the buffer itself, as on a real 5250 terminal.

import type { Codepage } from './ebcdic.ts';

export interface Field {
  /** Buffer address of the first data position; the attribute is at start - 1. */
  start: number;
  length: number;
  /** Field format word. */
  ffw: number;
  /** Field control words, raw. */
  fcws: number[];
  /** Field attribute byte (0x20-0x3F). */
  attr: number;
}

export const FieldShift = {
  0: 'alpha', 1: 'alphaOnly', 2: 'numericShift', 3: 'numericOnly',
  4: 'katakana', 5: 'digitsOnly', 6: 'io', 7: 'signedNumeric',
} as const;
export type FieldShiftName = (typeof FieldShift)[keyof typeof FieldShift];

export const FieldAdjust = { 0: 'none', 5: 'zeroFill', 6: 'blankFill', 7: 'mandatoryFill' } as const;
export type FieldAdjustName = (typeof FieldAdjust)[keyof typeof FieldAdjust] | 'none';

export const FFW = {
  BYPASS: 0x2000,
  DUP_ENABLE: 0x1000,
  MDT: 0x0800,
  AUTO_ENTER: 0x0080,
  FIELD_EXIT_REQUIRED: 0x0040,
  MONOCASE: 0x0020,
  MANDATORY_ENTER: 0x0008,
} as const;

export function fieldShift(f: Field): FieldShiftName {
  return FieldShift[((f.ffw >> 8) & 0x07) as keyof typeof FieldShift];
}

export function fieldAdjust(f: Field): FieldAdjustName {
  return FieldAdjust[(f.ffw & 0x07) as keyof typeof FieldAdjust] ?? 'none';
}

export type Color = 'green' | 'white' | 'red' | 'turquoise' | 'yellow' | 'pink' | 'blue';

export interface DisplayAttribute {
  color: Color;
  reverse: boolean;
  underline: boolean;
  blink: boolean;
  columnSeparator: boolean;
  nonDisplay: boolean;
}

/** Decode a 5250 color-display attribute byte (0x20-0x3F). */
export function decodeAttribute(a: number): DisplayAttribute {
  const group = a & 0x18;
  const hi = (a & 0x02) !== 0;
  const color: Color =
    group === 0x00 ? (hi ? 'white' : 'green')
    : group === 0x08 ? 'red'
    : group === 0x10 ? (hi ? 'yellow' : 'turquoise')
    : hi ? 'blue' : 'pink';
  const nonDisplay = (a & 0x07) === 0x07;
  return {
    color,
    reverse: !nonDisplay && (a & 0x01) !== 0,
    underline: !nonDisplay && (a & 0x04) !== 0,
    blink: group === 0x08 && hi,
    columnSeparator: group === 0x10,
    nonDisplay,
  };
}

export const isAttributeByte = (b: number): boolean => b >= 0x20 && b <= 0x3f;

export class Screen {
  rows = 24;
  cols = 80;
  buffer = new Uint8Array(24 * 80);
  fields: Field[] = [];
  /** Cursor buffer address. */
  cursor = 0;
  keyboardLocked = true;
  messageWaiting = false;
  alarm = false;
  /** 1-based row used by Write Error Code. 0 means the last row. */
  errorRow = 0;
  /** Set while the keyboard is in error state; holds the overwritten row. */
  error: { row: number; saved: Uint8Array } | null = null;

  get size(): number {
    return this.rows * this.cols;
  }

  clear(rows = 24, cols = 80): void {
    this.rows = rows;
    this.cols = cols;
    this.buffer = new Uint8Array(rows * cols);
    this.fields = [];
    this.cursor = 0;
    this.errorRow = 0;
    this.error = null;
    this.keyboardLocked = true;
  }

  clearFormatTable(): void {
    this.fields = [];
  }

  /** Convert 1-based row/col to a buffer address. */
  address(row: number, col: number): number {
    return ((row - 1) * this.cols + (col - 1) + this.size) % this.size;
  }

  rowCol(address: number): { row: number; col: number } {
    return { row: Math.floor(address / this.cols) + 1, col: (address % this.cols) + 1 };
  }

  effectiveErrorRow(): number {
    return this.errorRow >= 1 && this.errorRow <= this.rows ? this.errorRow : this.rows;
  }

  fieldAt(address: number): Field | undefined {
    return this.fields.find((f) => address >= f.start && address < f.start + f.length);
  }

  /** Add a field, replacing one with the same start and dropping any it overlaps. */
  defineField(field: Field): void {
    const end = field.start + field.length;
    this.fields = this.fields.filter(
      (f) => f.start !== field.start && (f.start + f.length <= field.start || f.start >= end),
    );
    this.fields.push(field);
    this.fields.sort((a, b) => a.start - b.start);
  }

  fieldBytes(f: Field): Uint8Array {
    return this.buffer.subarray(f.start, Math.min(f.start + f.length, this.size));
  }

  /** First non-bypass field, where the cursor goes when no IC order was given. */
  firstInputField(): Field | undefined {
    return this.fields.find((f) => (f.ffw & FFW.BYPASS) === 0);
  }
}

export interface Segment {
  /** 1-based starting column. */
  col: number;
  text: string;
  attr: DisplayAttribute;
}

export interface FieldSnapshot {
  /** Stable id: "row:col" of the first data position (1-based). */
  id: string;
  row: number;
  col: number;
  length: number;
  value: string;
  bypass: boolean;
  modified: boolean;
  monocase: boolean;
  mandatoryEnter: boolean;
  shift: FieldShiftName;
  adjust: FieldAdjustName;
  attr: DisplayAttribute;
}

export interface ScreenSnapshot {
  rows: number;
  cols: number;
  cursor: { row: number; col: number };
  keyboardLocked: boolean;
  messageWaiting: boolean;
  /** Text of the error line while the keyboard is in error state. */
  error: string | null;
  /** 1-based row where the host writes messages (normally the last row). */
  messageRow: number;
  /** Plain text of each row, with non-display data blanked. */
  lines: string[];
  segments: Segment[][];
  fields: FieldSnapshot[];
}

export const fieldId = (row: number, col: number): string => `${row}:${col}`;

export function snapshot(screen: Screen, cp: Codepage): ScreenSnapshot {
  const lines: string[] = [];
  const segments: Segment[][] = [];
  let current = decodeAttribute(0x20);

  for (let r = 0; r < screen.rows; r++) {
    let line = '';
    const rowSegs: Segment[] = [];
    for (let c = 0; c < screen.cols; c++) {
      const b = screen.buffer[r * screen.cols + c]!;
      let ch: string;
      let attr: DisplayAttribute;
      if (isAttributeByte(b)) {
        current = decodeAttribute(b);
        ch = ' ';
        // The attribute position itself displays as a plain blank.
        attr = { ...current, reverse: false, underline: false, columnSeparator: false };
      } else {
        ch = current.nonDisplay ? ' ' : cp.decodeChar(b);
        attr = current;
      }
      line += ch;
      const last = rowSegs.at(-1);
      if (last && sameAttr(last.attr, attr)) last.text += ch;
      else rowSegs.push({ col: c + 1, text: ch, attr });
    }
    lines.push(line);
    segments.push(rowSegs);
  }

  const fields = screen.fields.map((f): FieldSnapshot => {
    const { row, col } = screen.rowCol(f.start);
    const attr = decodeAttribute(f.attr);
    return {
      id: fieldId(row, col),
      row,
      col,
      length: f.length,
      // Never echo non-display (password) contents back out.
      value: attr.nonDisplay ? '' : cp.decode(screen.fieldBytes(f)).replace(/\s+$/, ''),
      bypass: (f.ffw & FFW.BYPASS) !== 0,
      modified: (f.ffw & FFW.MDT) !== 0,
      monocase: (f.ffw & FFW.MONOCASE) !== 0,
      mandatoryEnter: (f.ffw & FFW.MANDATORY_ENTER) !== 0,
      shift: fieldShift(f),
      adjust: fieldAdjust(f),
      attr,
    };
  });

  const error = screen.error ? lines[screen.error.row - 1]!.trim() : null;

  return {
    rows: screen.rows,
    cols: screen.cols,
    cursor: screen.rowCol(screen.cursor),
    keyboardLocked: screen.keyboardLocked,
    messageWaiting: screen.messageWaiting,
    error,
    messageRow: screen.effectiveErrorRow(),
    lines,
    segments,
    fields,
  };
}

function sameAttr(a: DisplayAttribute, b: DisplayAttribute): boolean {
  return a.color === b.color && a.reverse === b.reverse && a.underline === b.underline
    && a.blink === b.blink && a.columnSeparator === b.columnSeparator && a.nonDisplay === b.nonDisplay;
}
