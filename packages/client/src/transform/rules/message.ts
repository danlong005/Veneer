// The host message line (normally the last row) -> a banner.

import type { TransformContext } from '../context.ts';

export function messageLine(ctx: TransformContext): void {
  const row = ctx.snap.messageRow;
  const inside = row >= ctx.region.top && row <= ctx.region.bottom;
  if (ctx.snap.error) {
    ctx.view.message = { text: ctx.snap.error, kind: 'error' };
    if (inside) ctx.claimRow(row);
    return;
  }
  if (!inside || ctx.fieldsOn(row).length > 0) return;
  const text = ctx.chunks(row).map((c) => c.text).join('  ');
  if (text) ctx.view.message = { text, kind: 'info' };
  ctx.claimRow(row);
}
