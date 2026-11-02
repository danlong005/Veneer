// First row -> page title (the highlighted text nearest the center) plus metadata.

import type { TransformContext } from '../context.ts';
import type { TextItem } from '../types.ts';

export function title(ctx: TransformContext): void {
  const row = ctx.region.top;
  if (ctx.fieldsOn(row).length > 0) return;
  const chunks = ctx.chunks(row);
  if (chunks.length === 0) return;
  const center = (ctx.region.left + ctx.region.right + 1) / 2;
  const distance = (c: (typeof chunks)[number]) => Math.abs((c.col + c.end) / 2 - center);
  // On a 3270, a header row of label/value pairs ("Terminal  CUU0C0   Date  02.11.26")
  // has no title: neither a short label nor the value just after it is one. Dash runs
  // around a title ("----  RFE DSLIST  ---- Row 1 of 129") are skipped when measuring.
  type C = (typeof chunks)[number];
  const filler = (c: C) => /^[-=*_. ]+$/.test(c.text);
  const label = (c: C) => c.text.length <= 12 && /^[A-Za-z][A-Za-z ]*:?$/.test(c.text);
  const startOf = (c: C) => c.col + (/^[-=*_.]*\s*/.exec(c.text)?.[0].length ?? 0);
  const endOf = (c: C) => c.end - (/\s*[-=*_.]*$/.exec(c.text)?.[0].length ?? 0);
  const left = (c: C) => chunks.filter((o) => o.end <= c.col && !filler(o)).at(-1);
  const right = (c: C) => chunks.find((o) => o.col >= c.end && !filler(o));
  const near = (a: C | undefined, b: C | undefined) => a !== undefined && b !== undefined && startOf(b) - endOf(a) <= 4;
  const paired = (c: C) => ctx.snap.host === '3270'
    && ((label(c) && near(c, right(c))) || (left(c) !== undefined && label(left(c)!) && near(left(c), c)));
  const candidates = chunks.filter((c) => !filler(c) && !paired(c));
  const highlighted = candidates.filter((c) => c.attr.color === 'white');
  const pool = highlighted.length > 0 ? highlighted : candidates.filter((c) => c.col > ctx.region.left + 9);
  const best = [...pool].sort((a, b) => distance(a) - distance(b))[0];
  if (best) ctx.view.title = best.text;
  // Group nearby chunks so "System:   PUB400" stays one item. Header items keep
  // their position so customizations can hide, rename or restyle them; they
  // start as 'normal' because the header has its own look.
  const meta: TextItem[] = [];
  let prevEnd = -Infinity;
  for (const c of chunks) {
    if (c === best) { prevEnd = -Infinity; continue; }
    const last = meta.at(-1);
    if (c.col - prevEnd <= 4 && last) {
      last.text += ` ${c.text}`;
      last.width = c.end - last.col;
    } else {
      meta.push({ kind: 'text', row, col: c.col, width: c.end - c.col, text: c.text, role: 'normal', reverse: false, underline: false });
    }
    prevEnd = c.end;
  }
  ctx.view.meta = meta;
  ctx.claimRow(row);
}

/** Inside a window: the first row is a title only if it is entirely highlighted text. */
export function windowTitle(ctx: TransformContext): void {
  const row = ctx.region.top;
  const chunks = ctx.chunks(row);
  if (chunks.length === 0 || ctx.fieldsOn(row).length > 0) return;
  if (!chunks.every((c) => c.attr.color === 'white')) return;
  ctx.view.title = chunks.map((c) => c.text).join(' ');
  ctx.claimRow(row);
}
