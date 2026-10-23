// "===> ________" -> a command input.

import type { TransformContext } from '../context.ts';

export function commandLine(ctx: TransformContext): void {
  for (const row of ctx.rows(ctx.region.top + 1)) {
    for (const arrow of ctx.chunks(row).filter((c) => c.text.endsWith('===>'))) {
      const field = ctx.fieldsOn(row).find((f) => f.col >= arrow.end && f.col <= arrow.end + 3);
      if (!field) continue;
      const label = arrow.text.replace(/\s*===>$/, '');
      if (label) ctx.view.items.push(textItem(arrow.row, arrow.col, label, arrow.attr.color === 'white'));
      ctx.claim(arrow.row, arrow.col, arrow.end - arrow.col);
      ctx.view.items.push({ kind: 'field', row: field.row, col: field.col, width: field.length, field, command: true, label: label || 'Command' });
      ctx.claimField(field);
    }
  }
}

function textItem(row: number, col: number, text: string, emphasis: boolean) {
  return { kind: 'text' as const, row, col, width: text.length, text, role: emphasis ? 'emphasis' as const : 'normal' as const, reverse: false, underline: false };
}
