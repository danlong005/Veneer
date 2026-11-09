// Remaining input fields -> inputs, labelled by the nearest text on their left.

import type { TransformContext } from '../context.ts';
import { stripLeaders } from '../text.ts';

export function fields(ctx: TransformContext): void {
  for (const field of ctx.inputs) {
    if (ctx.isFieldClaimed(field)) continue;
    const label = ctx.chunks(field.row)
      .filter((c) => c.end <= field.col)
      .map((c) => stripLeaders(c.text))
      .findLast((t) => t !== '') ?? '';
    ctx.view.items.push({
      kind: 'field', row: field.row, col: field.col, width: field.length, field,
      ...(label ? { label } : {}),
    });
    ctx.claimField(field);
  }
}
