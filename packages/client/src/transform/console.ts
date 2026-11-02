// TSO's line mode as a console: earlier screens of output kept above the live
// one, so they can be scrolled back to. A terminal loses them each time TSO
// fills the screen, shows ***, and erases it to carry on.
//
// The live screen (the page) is drawn as usual; this keeps the lines from the
// pages before it. A new line-mode screen either continues the page (TSO wrote
// more lines under the ones already there) or starts a new one (TSO erased the
// screen), which moves the old page into the history.

import type { FieldSnapshot, ScreenSnapshot } from '@veneer/terminal';
import { lineModeInput } from './lineMode.ts';

export interface ConsoleLog {
  /** Lines from earlier pages, oldest first. */
  history: readonly string[];
  /** The output lines of the live screen, as last seen. */
  page: readonly string[];
}

export const EMPTY_CONSOLE: ConsoleLog = { history: [], page: [] };

/** Lines kept: the oldest go first. */
export const MAX_HISTORY = 2000;

/**
 * The next log after a screen arrives. A full-screen program (a screen with
 * protected fields, once the keyboard is free) ends the console; a blank
 * screen (TSO erasing before it writes, or Clear) leaves it as it is.
 */
export function nextConsole(log: ConsoleLog, snap: ScreenSnapshot): ConsoleLog {
  const input = lineModeInput(snap);
  if (!input) {
    const fullScreen = !snap.keyboardLocked && snap.fields.some((f) => f.bypass);
    return fullScreen ? EMPTY_CONSOLE : log;
  }
  const page = pageLines(snap, input);
  if (continues(log.page, page)) return { history: log.history, page };
  // TSO's *** only asks for Enter before it erases the screen: not output to keep.
  const kept = log.page.filter((l) => l.trim() !== '***');
  return { history: [...log.history, ...kept].slice(-MAX_HISTORY), page };
}

/** A screen's output: its rows without the input being typed, and without blank rows at the end. */
export function pageLines(snap: ScreenSnapshot, input: FieldSnapshot): string[] {
  const rows = snap.lines.map((l) => [...l]);
  const start = (input.row - 1) * snap.cols + (input.col - 1);
  // The input runs to the end of the screen in line mode, and could wrap.
  for (let i = 0; i < input.length; i++) {
    const a = (start + i) % (snap.rows * snap.cols);
    rows[Math.floor(a / snap.cols)]![a % snap.cols] = ' ';
  }
  const lines = rows.map((r) => r.join('').trimEnd());
  while (lines.length > 0 && lines.at(-1) === '') lines.pop();
  return lines;
}

/**
 * Whether `next` is `page` with more written: every character already there is
 * unchanged. Blanks may fill in, as where a command was typed into the input.
 */
function continues(page: readonly string[], next: readonly string[]): boolean {
  return page.every((line, i) => [...line].every((ch, k) => ch === ' ' || ch === next[i]?.[k]));
}
