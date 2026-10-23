// Row 1 -> page title (the highlighted text nearest the center) plus metadata.

import type { TransformContext } from '../context.ts';

export function title(ctx: TransformContext): void {
  if (ctx.fieldsOn(1).length > 0) return;
  const chunks = ctx.chunks(1);
  if (chunks.length === 0) return;
  const center = ctx.snap.cols / 2;
  const distance = (c: (typeof chunks)[number]) => Math.abs((c.col + c.end) / 2 - center);
  const highlighted = chunks.filter((c) => c.attr.color === 'white');
  const pool = highlighted.length > 0 ? highlighted : chunks.filter((c) => c.col > 10);
  const best = [...pool].sort((a, b) => distance(a) - distance(b))[0];
  if (best) ctx.view.title = best.text;
  // Group nearby chunks so "System:   PUB400" stays one item.
  const meta: string[] = [];
  let prevEnd = -Infinity;
  for (const c of chunks) {
    if (c === best) { prevEnd = -Infinity; continue; }
    if (c.col - prevEnd <= 4 && meta.length > 0) meta[meta.length - 1] += ` ${c.text}`;
    else meta.push(c.text);
    prevEnd = c.end;
  }
  ctx.view.meta = meta;
  ctx.claimRow(1);
}
