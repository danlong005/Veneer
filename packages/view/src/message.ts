// The host's message on a screen, as the browser shows it: the message line
// (a window's own, when one is open) and any error. Macro checks on the
// message read it through this, in the browser and in macro API runs alike.

import type { ScreenSnapshot } from '@veneer/terminal';
import { transform } from './transform/index.ts';

export function screenMessages(snap: ScreenSnapshot): string[] {
  const view = transform(snap);
  const out: string[] = [];
  const line = (view.window?.message ?? view.message)?.text.trim();
  if (line) out.push(line);
  const error = snap.error?.trim();
  if (error && !out.includes(error)) out.push(error);
  return out;
}

/** The messages as one string, for a macro check. */
export const screenMessage = (snap: ScreenSnapshot): string => screenMessages(snap).join(' ');
