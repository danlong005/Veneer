// Auto-transform pipeline: snapshot -> rules -> view model. Rules run in
// order; each claims the cells it renders so later rules skip them. Custom
// per-screen rules can be inserted into the list later.

import type { ScreenSnapshot } from '@veneer/tn5250';
import { TransformContext } from './context.ts';
import { commandLine } from './rules/commandLine.ts';
import { fields } from './rules/fields.ts';
import { functionKeys } from './rules/functionKeys.ts';
import { menu } from './rules/menu.ts';
import { messageLine } from './rules/message.ts';
import { subfile } from './rules/subfile.ts';
import { text } from './rules/text.ts';
import { title } from './rules/title.ts';
import type { ScreenView } from './types.ts';

export type Rule = (ctx: TransformContext) => void;

export const DEFAULT_RULES: readonly Rule[] = [
  functionKeys, messageLine, title, subfile, menu, commandLine, fields, text,
];

export function transform(snap: ScreenSnapshot, rules: readonly Rule[] = DEFAULT_RULES): ScreenView {
  const ctx = new TransformContext(snap);
  for (const rule of rules) rule(ctx);
  ctx.view.items.sort((a, b) => a.row - b.row || a.col - b.col);
  return ctx.view;
}

export { TransformContext } from './context.ts';
export type * from './types.ts';
