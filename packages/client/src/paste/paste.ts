// Pasting rows copied from a spreadsheet (#43): tab-separated text, a line
// per row, goes into the entry fields from the one pasted into, to the right
// and down: a list's rows, or entry fields repeated down the screen. One row
// pasted on an ordinary entry screen fills the fields that follow, in order.
//
// Every value goes through what typing it would: the field's characters,
// monocase, its length, and its widget (a dropdown's choices, a checkbox's
// on and off values, a date's host format). Nothing is sent: the values are
// shown for the user to confirm, then become ordinary edits.

import { isoToHost, timeToHost, type Widget } from '@veneer/screens';
import type { FieldSnapshot } from '@veneer/terminal';
import { monocase } from '@veneer/terminal';
import type { Item, ScreenView, TableItem } from '@veneer/view';
import { applyMask, maskLength } from '../ui/mask.ts';
import { filterValue, withSign } from '../ui/fieldRules.ts';

/** The most cells one paste takes, so a whole sheet pasted by mistake doesn't hang the page. */
export const MAX_PASTE_CELLS = 5000;

/**
 * Tab-separated text as Excel, Google Sheets and LibreOffice copy it: a line
 * per row, a tab between cells, and a cell holding a tab, a line break or a
 * quote in double quotes ("" for a quote). The line break after the last row
 * isn't another row.
 */
export function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  const s = text.replace(/\r\n?/g, '\n');
  while (i < s.length) {
    const c = s[i]!;
    if (c === '"' && cell === '') {
      // A quoted cell: up to the quote that isn't doubled.
      let j = i + 1;
      let quoted = '';
      while (j < s.length) {
        if (s[j] === '"') {
          if (s[j + 1] === '"') { quoted += '"'; j += 2; continue; }
          break;
        }
        quoted += s[j++];
      }
      // Only a quote that closes before a tab or line end makes it a quoted cell.
      if (j < s.length && (j + 1 === s.length || s[j + 1] === '\t' || s[j + 1] === '\n')) {
        cell = quoted;
        i = j + 1;
        continue;
      }
    }
    if (c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
    i++;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

/** The text is more than one cell: a paste for this, not for the field. */
export const isRows = (text: string): boolean => /[\t\n]/.test(text.replace(/\r?\n$/, ''));

/** Where a pasted value goes, and what it is called there. */
export interface Target {
  field: FieldSnapshot;
  widget?: Widget;
  /** The list's column heading or the field's label, for the preview. */
  name: string;
}

/** The fields a paste fills, as rows of targets (null where a row has no field in that column), and what kind of place it is. */
export interface PasteGrid {
  kind: 'list' | 'rows' | 'fields';
  rows: Array<Array<Target | null>>;
}

type Input = Target & { table?: TableItem };

/** Every input field of the view with its widget and name, in screen order (the pop-up window's when one is open). */
function inputs(view: ScreenView): Input[] {
  const items: Item[] = view.window ? view.window.items : view.items;
  const out: Input[] = [];
  for (const item of items) {
    if (item.kind === 'field' && !item.field.bypass) out.push({ field: item.field, ...(item.widget ? { widget: item.widget } : {}), name: item.label ?? item.field.id });
    if (item.kind === 'table') {
      for (const r of item.rows) for (const c of r.cells) {
        if (!c.field || c.field.bypass) continue;
        const heading = item.columns.find((h) => c.col >= h.col && c.col < h.col + Math.max(h.width, 1))?.header.trim();
        out.push({ field: c.field, ...(c.widget ? { widget: c.widget } : {}), name: heading || c.field.id, table: item });
      }
    }
  }
  return out.sort((a, b) => a.field.row - b.field.row || a.field.col - b.field.col);
}

/**
 * The fields to fill from the one pasted into (`at`, a field id), for a paste
 * `width` cells wide and `height` rows high:
 *
 * - **list**: in a list, its rows from this one down, its input columns from this one right;
 * - **rows**: entry fields repeated down the screen at the same columns (an order's lines);
 * - **fields**: one row pasted on an ordinary screen: this field and the ones after it.
 *
 * Null when `at` isn't an input field.
 */
export function pasteGrid(view: ScreenView, at: string, width: number, height: number): PasteGrid | null {
  const all = inputs(view);
  const start = all.find((t) => t.field.id === at);
  if (!start) return null;
  const same = all.filter((t) => t.table === start.table);
  const onRow = (row: number) => same.filter((t) => t.field.row === row && t.field.col >= start.field.col);
  const first = onRow(start.field.row);
  const cols = first.map((t) => t.field.col);
  const rows: Input[][] = [first];
  const below = [...new Set(same.filter((t) => t.field.row > start.field.row).map((t) => t.field.row))].sort((a, b) => a - b);
  let last = start.field.row;
  for (const r of below) {
    if (rows.length >= height) break;
    const here = onRow(r);
    if (here[0]?.field.col !== start.field.col) {
      // A list's record can take two lines, the second without this column's field.
      if (start.table) continue;
      break;
    }
    // Outside a list, the rows must follow each other.
    if (!start.table && r !== last + 1) break;
    rows.push(here);
    last = r;
  }
  const aligned = rows.map((row) => cols.map((c) => { const t = row.find((x) => x.field.col === c); return t ? stripOne(t) : null; }));
  if (start.table) return { kind: 'list', rows: aligned };
  if (height === 1 && first.length < width) {
    // One row, wider than the fields on this line: the fields from here on, in order.
    const k = all.indexOf(start);
    return { kind: 'fields', rows: [all.slice(k, k + width).map(stripOne)] };
  }
  return { kind: 'rows', rows: aligned };
}

const stripOne = (t: Input): Target => ({ field: t.field, ...(t.widget ? { widget: t.widget } : {}), name: t.name });

/** A cell's value as the field takes it, or why it can't be. */
export function fieldValue(cell: string, t: Target): { value: string } | { problem: string } {
  const text = cell.trim();
  const w = t.widget;
  let value = text;
  if (w && text !== '') {
    const converted = widgetValue(text, w);
    if ('problem' in converted) return converted;
    value = converted.value;
  }
  const f = t.field;
  if (f.monocase) value = monocase(value);
  if (f.shift === 'signedNumeric' && /^[-+]|[-+]$/.test(value)) value = withSign(value, value.includes('-'));
  if (filterValue(f, value) !== value) {
    const numbers = f.shift === 'signedNumeric' ? 'digits, and a sign' : f.shift === 'digitsOnly' ? 'digits' : 'numbers';
    return { problem: `“${text}” has characters the field doesn't take (${numbers} only${f.shift === 'signedNumeric' && /[.,]/.test(text) ? '; the decimal point is implied, as in 1250 for 12.50' : ''}).` };
  }
  if (value.length > f.length) return { problem: `“${text}” is longer than the field (${f.length} characters).` };
  return { value };
}

const TRUE = new Set(['y', 'yes', 'true', 'x', '1', 'on', '✓', '✔']);
const FALSE = new Set(['n', 'no', 'false', '0', 'off', '-']);

function widgetValue(text: string, w: Widget): { value: string } | { problem: string } {
  switch (w.type) {
    case 'select':
    case 'radio': {
      const o = w.options.find((x) => x.value.trim() === text) ?? w.options.find((x) => x.label.trim().toLowerCase() === text.toLowerCase() || x.value.trim().toLowerCase() === text.toLowerCase());
      return o ? { value: o.value } : { problem: `“${text}” isn't one of the choices (${w.options.map((x) => x.label).slice(0, 6).join(', ')}${w.options.length > 6 ? '…' : ''}).` };
    }
    case 'lookup': {
      const o = w.options?.find((x) => x.label.trim().toLowerCase() === text.toLowerCase());
      return { value: o ? o.value : text };
    }
    case 'checkbox':
    case 'toggle': {
      const t = text.toLowerCase();
      if (text === w.on.trim() || TRUE.has(t)) return { value: w.on };
      if (text === w.off.trim() || FALSE.has(t)) return { value: w.off };
      return { problem: `“${text}” isn't on or off (${w.on.trim() || 'blank'} or ${w.off.trim() || 'blank'}, or yes or no).` };
    }
    case 'date': {
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
      if (iso) return { value: isoToHost(iso, w.format) };
      if (text.length === w.format.length && [...w.format].every((f, i) => ('YMD'.includes(f) ? /\d/.test(text[i]!) : text[i] === f))) return { value: text };
      return { problem: `“${text}” isn't a date as ${w.format} or YYYY-MM-DD.` };
    }
    case 'time': {
      const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
      if (m) return { value: timeToHost(`${m[1]!.padStart(2, '0')}:${m[2]}${m[3] ? `:${m[3]}` : ''}`, w.format) };
      if (text.length === w.format.length) return { value: text };
      return { problem: `“${text}” isn't a time as ${w.format} or HH:MM.` };
    }
    case 'mask': {
      const { host } = applyMask(text, w);
      return host.length === maskLength(w) || host.length === [...text].length ? { value: host } : { problem: `“${text}” doesn't fit the pattern ${w.mask}.` };
    }
    default:
      return { value: text };
  }
}

/** A paste worked out: the edits it makes, and what stopped it. */
export interface PastePlan {
  kind: PasteGrid['kind'];
  /** The fields of the first row: the preview's columns. */
  columns: Array<Target | null>;
  /** The rows of the preview, a cell per column: its value, or null where the cell is blank and the field is left as it is. */
  rows: Array<Array<string | null>>;
  /** Field id -> value, for the cells before any problem. */
  edits: Record<string, string>;
  /** The cell that stopped it: 1-based row and column of the paste, and the field's name. */
  problem?: { row: number; col: number; message: string; name?: string; cell: string };
  /** Rows and columns pasted that have no field to go in. */
  extraRows: number;
  extraCols: number;
  /** Cells the paste had in all. */
  cells: number;
}

/**
 * The edits a paste makes. A blank cell leaves its field as it is. It stops
 * at the first value a field won't take, keeping the cells before it; the
 * preview's rows end there.
 */
export function planPaste(view: ScreenView, at: string, text: string): PastePlan | { error: string } {
  const data = parseRows(text);
  const cells = data.reduce((n, r) => n + r.length, 0);
  if (cells > MAX_PASTE_CELLS) return { error: `That's ${cells} cells; paste at most ${MAX_PASTE_CELLS} at a time.` };
  const width = Math.max(0, ...data.map((r) => r.length));
  const grid = pasteGrid(view, at, width, data.length);
  if (!grid) return { error: 'Click in an entry field first.' };
  const rows: PastePlan['rows'] = [];
  const edits: Record<string, string> = {};
  let problem: PastePlan['problem'];
  let extraCols = 0;
  for (let i = 0; i < Math.min(data.length, grid.rows.length) && !problem; i++) {
    const targets = grid.rows[i]!;
    const cellsHere = data[i]!;
    extraCols = Math.max(extraCols, cellsHere.length - targets.length);
    const row: PastePlan['rows'][number] = [];
    for (let j = 0; j < Math.min(cellsHere.length, targets.length); j++) {
      const target = targets[j];
      const cell = cellsHere[j]!;
      if (cell.trim() === '') { row.push(null); continue; }
      const v = target ? fieldValue(cell, target) : { problem: `“${cell.trim()}” has no field to go in on this row.` };
      if ('problem' in v) {
        problem = { row: i + 1, col: j + 1, message: v.problem, cell: cell.trim(), ...(target ? { name: target.name } : {}) };
        break;
      }
      row.push(v.value);
      edits[target!.field.id] = v.value;
    }
    rows.push(row);
  }
  return { kind: grid.kind, columns: grid.rows[0]!.slice(0, Math.max(1, width)), rows, edits, ...(problem ? { problem } : {}), extraRows: Math.max(0, data.length - grid.rows.length), extraCols, cells };
}

/** The problem as the notice says it: which row and column of the paste, and the field's name. */
export function problemText(plan: PastePlan): string | undefined {
  const p = plan.problem;
  if (!p) return undefined;
  return `Row ${p.row}, column ${p.col}${p.name && !/^\d+:\d+$/.test(p.name) ? ` (${p.name})` : ''}: ${p.message}`;
}
