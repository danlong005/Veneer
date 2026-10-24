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
  const highlighted = chunks.filter((c) => c.attr.color === 'white');
  const pool = highlighted.length > 0 ? highlighted : chunks.filter((c) => c.col > ctx.region.left + 9);
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
