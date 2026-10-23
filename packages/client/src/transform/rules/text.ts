// Everything left over -> positioned text with dot leaders removed.

import { roleOf, type TransformContext } from '../context.ts';
import { stripLeaders } from '../text.ts';

export function text(ctx: TransformContext): void {
  for (const row of ctx.rows()) {
    for (const c of ctx.chunks(row)) {
      const t = stripLeaders(c.text);
      ctx.claim(c.row, c.col, c.end - c.col);
      if (!t) continue;
      ctx.view.items.push({
        kind: 'text', row: c.row, col: c.col, width: c.end - c.col, text: t,
        role: roleOf(c.attr), reverse: c.attr.reverse, underline: c.attr.underline,
      });
    }
  }
}
