// Subfiles -> tables. A subfile is recognised by its "More..." / "Bottom"
// marker; the rows above it run up to highlighted column headings. An options
// legend ("2=Change  4=Delete") above the headings becomes a dropdown in the
// option column.
//
// On a 3270, lists in ISPF-style tools have no marker: they are highlighted
// column headings followed by rows that all have the same input fields (a
// selection column), and "Row 22 of 129" above them says whether there is more.

import type { FieldSnapshot } from '@veneer/terminal';
import { roleOf, type Chunk, type TransformContext } from '../context.ts';
import { legendTokens, rowLine } from '../text.ts';
import type { Option, TableCell, TableColumn, TableRow } from '../types.ts';

const MARKER = /^(More\.\.\.|More…|Bottom|\+)$/;
/** How far above the marker to look for column headings. */
const MAX_PAGE_ROWS = 22;

export function subfile(ctx: TransformContext): void {
  const { top, left, right } = ctx.region;
  for (const row of ctx.rows(top + 3)) {
    const marker = ctx.chunks(row).find((c) =>
      MARKER.test(c.text) && c.col > (left + right) / 2 && (c.text !== '+' || c.end >= right));
    if (marker) buildTable(ctx, row, { marker });
  }
  if (ctx.snap.host === '3270') ispfLists(ctx);
}

/** Fewest rows for a list without a marker, so a short form isn't taken for one. */
const MIN_LIST_ROWS = 3;

function ispfLists(ctx: TransformContext): void {
  const { top, bottom } = ctx.region;
  const layout = (row: number) => ctx.fieldsOn(row).map((f) => `${f.col}/${f.length}`).join(' ');
  for (let header = top + 1; header < bottom; header++) {
    const first = layout(header + 1);
    if (!first) continue;
    let last = header + 1;
    while (last < bottom && layout(last + 1) === first) last++;
    if (last - header < MIN_LIST_ROWS || !isListHeader(ctx, header, last)) continue;
    buildTable(ctx, last, { header, more: moreBelow(ctx, header, last - header) });
    header = last;
  }
}

/**
 * Column headings over a 3270 list: no inputs, at least three words, all in one
 * colour (often white or yellow) that none of the list's rows use.
 */
function isListHeader(ctx: TransformContext, header: number, last: number): boolean {
  const chunks = ctx.chunks(header);
  if (ctx.fieldsOn(header).length > 0 || words(chunks).length < 3) return false;
  const color = chunks[0]!.attr.color;
  if (!chunks.every((c) => c.attr.color === color)) return false;
  return range(header + 1, last).every((r) => ctx.chunks(r).every((c) => c.attr.color !== color));
}

/** ISPF separates column headings with single spaces, so split them into words. */
function words(chunks: Chunk[]): Chunk[] {
  return chunks.flatMap((c) => [...c.text.matchAll(/\S+/g)].map((m) => {
    const col = c.col + m.index;
    return { ...c, col, end: col + m[0].length, text: m[0] };
  }));
}

/** From "Row 22 of 129" above the list; without one, assume there may be more (paging stops when it can't move). */
function moreBelow(ctx: TransformContext, header: number, shown: number): boolean {
  for (const r of ctx.rows(ctx.region.top, header - 1)) {
    // From the screen's text: the title rule may already have taken this row.
    const text = ctx.snap.lines[r - 1]!.slice(ctx.region.left - 1, ctx.region.right);
    const m = /\bRow\s+(\d+)\s+of\s+(\d+)/i.exec(text);
    if (m) return Number(m[1]) + shown - 1 < Number(m[2]);
  }
  return true;
}

function isHeaderRow(ctx: TransformContext, row: number): boolean {
  if (row <= ctx.region.top || ctx.fieldsOn(row).length > 0) return false;
  const chunks = ctx.chunks(row);
  return chunks.length > 0 && chunks.every((c) => c.attr.color === 'white');
}

interface TableFrom {
  /** The "More..." / "Bottom" marker on the last row (5250). */
  marker?: Chunk;
  /** The heading row, when already known (3270 lists). */
  header?: number;
  /** Whether the host has more rows, when there is no marker to say. */
  more?: boolean;
}

/** A table whose data ends on `markerRow` (or the row above, if the marker is alone on it). */
/** How far left of its heading an input field can start and still be in its column. */
const MAX_FIELD_LEAD = 3;

function buildTable(ctx: TransformContext, markerRow: number, from: TableFrom): void {
  const { marker } = from;
  const right = ctx.region.right;
  const markerAlone = marker !== undefined && ctx.chunks(markerRow).length === 1 && ctx.fieldsOn(markerRow).length === 0;
  const lastData = markerAlone ? markerRow - 1 : markerRow;

  let header = from.header ?? -1;
  for (let r = lastData; header < 0 && r >= Math.max(ctx.region.top + 1, lastData - MAX_PAGE_ROWS); r--) {
    if (isHeaderRow(ctx, r)) header = r;
  }
  if (header < 0 || header >= lastData) return;
  const top = isHeaderRow(ctx, header - 1) ? header - 1 : header;
  const dataRows = range(header + 1, lastData);

  // Column starts come from the bottom heading row.
  const headerChunks = marker ? ctx.chunks(header).filter((c) => c !== marker) : words(ctx.chunks(header));
  const starts = headerChunks.map((c) => c.col);
  // ISPF pads headings with dashes ("DATA-SET-NAME-------").
  const headers = headerChunks.map((c) => (marker ? c.text : c.text.replace(/-{2,}$/, '')));
  if (top < header) {
    for (const c of ctx.chunks(top)) {
      const k = Math.max(0, starts.findLastIndex((s) => s <= c.col));
      headers[k] = `${c.text} ${headers[k] ?? ''}`.trim();
    }
  }

  const lines = new Map(dataRows.map((r) => [r, rowLine(ctx, r)]));
  const dataFields = dataRows.flatMap((r) => ctx.fieldsOn(r));
  const dataChunkCols = dataRows.flatMap((r) => ctx.chunks(r).filter((c) => c !== marker).map((c) => c.col));
  const firstCol = Math.min(starts[0] ?? right, ...dataFields.map((f) => f.col), ...dataChunkCols);

  // A heading word that a value runs across, from at or before the previous
  // heading, is part of that heading ("Data Set Name"), not a column of its own.
  if (!marker) {
    for (let k = starts.length - 1; k >= 1; k--) {
      const b = starts[k]!;
      const across = [...lines.values()].some((l) => l[b - 2] !== ' ' && l[b - 1] !== ' ' && runStart(l, b - 1) <= starts[k - 1]!);
      if (!across) continue;
      starts.splice(k, 1);
      headers.splice(k - 1, 2, `${headers[k - 1]} ${headers[k]}`);
    }
  }

  // Move each boundary left past any value that straddles it (right-aligned numbers).
  const bounds = [firstCol, ...starts.slice(1)];
  for (let k = 1; k < bounds.length; k++) {
    let b = bounds[k]!;
    const straddles = (col: number) => [...lines.values()].some((l) => l[col - 2] !== ' ' && l[col - 1] !== ' ');
    while (b - 1 > bounds[k - 1]! && straddles(b)) b--;
    bounds[k] = b;
  }
  // A cell holds one field. An input field a little left of its heading (DDS
  // often puts the heading over the field's data, a column or two in) would
  // share the column before with that column's own field, and be dropped:
  // the edge moves left to it instead, unless that would cut text shown on a row.
  for (let k = 1; k < bounds.length; k++) {
    for (const r of dataRows) {
      const inLeft = ctx.fieldsOn(r).filter((f) => f.col >= bounds[k - 1]! && f.col < bounds[k]!);
      const last = inLeft[inLeft.length - 1];
      if (inLeft.length < 2 || !last || bounds[k]! - last.col > MAX_FIELD_LEAD) continue;
      const cuts = dataRows.some((d) => ctx.chunks(d).some((c) => c !== marker && c.col < last.col && c.end > last.col));
      if (!cuts) bounds[k] = last.col;
    }
  }
  const options = optionsLegend(ctx, top);
  const optionCol = options.length > 0 ? optionColumn(bounds, dataFields) : -1;

  const columns: TableColumn[] = bounds.map((col, k) => ({
    col, width: (bounds[k + 1] ?? right + 1) - col, header: headers[k] ?? '',
  }));

  const tableRows: TableRow[] = [];
  for (const r of dataRows) {
    const line = lines.get(r)!;
    const rowFields = ctx.fieldsOn(r);
    const cells: TableCell[] = columns.map((c, k) => {
      const end = c.col + c.width;
      const field = rowFields.find((f) => f.col >= c.col && f.col < end);
      const chunk = ctx.chunks(r).find((x) => x !== marker && x.col < end && x.end > c.col);
      return {
        col: c.col, width: c.width,
        text: line.slice(c.col - 1, end - 1).trim(),
        role: chunk ? roleOf(chunk.attr) : 'normal',
        ...(field ? { field } : {}),
        ...(field && k === optionCol ? { options } : {}),
      };
    });
    if (cells.some((c) => c.text || c.field)) tableRows.push({ row: r, cells });
  }

  ctx.view.items.push({
    kind: 'table', row: top, col: firstCol, width: right - firstCol + 1,
    height: lastData - top + 1, headerRows: header - top + 1,
    columns, rows: tableRows, more: marker ? marker.text !== 'Bottom' : from.more ?? true,
  });
  for (const r of range(top, lastData)) ctx.claimRow(r, firstCol);

  if (!marker) return;
  const width = marker.end - marker.col;
  if (marker.text === 'Bottom') {
    ctx.view.items.push({ kind: 'text', row: markerRow, col: marker.col, width, text: 'Bottom', role: 'muted', reverse: false, underline: false });
  } else {
    ctx.view.items.push({ kind: 'link', row: markerRow, col: marker.col, width, text: 'More', key: '', action: { aid: 'PageDown' } });
  }
  ctx.claim(markerRow, marker.col, width);
}

/** "2=Change  4=Delete  5=Display" rows above the table. */
function optionsLegend(ctx: TransformContext, top: number): Option[] {
  const options: Option[] = [];
  for (const r of ctx.rows(ctx.region.top + 1, top - 1)) {
    for (const t of legendTokens(rowLine(ctx, r), String.raw`\d{1,2}`)) {
      if (!options.some((o) => o.value === t.key)) options.push({ value: t.key, label: t.label });
    }
  }
  return options;
}

/** Index of the first column holding short input fields (the "Opt" column). */
function optionColumn(bounds: number[], fields: FieldSnapshot[]): number {
  for (let k = 0; k < bounds.length; k++) {
    const end = bounds[k + 1] ?? Infinity;
    if (fields.some((f) => f.col >= bounds[k]! && f.col < end && f.length <= 3)) return k;
  }
  return -1;
}

/** The 1-based column where the run of non-blank characters through `col` starts. */
function runStart(line: string, col: number): number {
  let i = col - 1;
  while (i > 0 && line[i - 1] !== ' ') i--;
  return i + 1;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
}
