// Text helpers shared by rules.

import type { TransformContext } from './context.ts';

/** Strip CUA dot leaders: "User . . . . . . :" -> "User". Leaves "More..." alone. */
export function stripLeaders(text: string): string {
  return text.replace(/(?:\s*\.(?=\s|$|:)){2,}\s*:?\s*$/, '').trim();
}

/** The row's unclaimed text laid out at its columns (index 0 = column 1). */
export function rowLine(ctx: TransformContext, row: number): string {
  const chars = new Array<string>(ctx.snap.cols).fill(' ');
  for (const c of ctx.chunks(row)) {
    for (let i = 0; i < c.text.length; i++) chars[c.col - 1 + i] = c.text[i]!;
  }
  return chars.join('');
}

export interface Token {
  key: string;
  label: string;
  /** 1-based start column of "key=label". */
  col: number;
  length: number;
}

/**
 * Find "key=label" tokens such as "F3=Exit" or "2=Change" on a line. Returns
 * them only if they make up most of the line's text, so ordinary sentences
 * containing "=" are not mistaken for a legend.
 */
export function legendTokens(line: string, key: string): Token[] {
  const re = new RegExp(`(?<=^|\\s)(${key})=(\\S(?:.*?\\S)?)(?=\\s+(?:${key})=|\\s{2,}|\\s*$)`, 'g');
  const tokens: Token[] = [];
  let covered = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    tokens.push({ key: m[1]!, label: m[2]!, col: m.index + 1, length: m[0].length });
    covered += m[0].replace(/\s/g, '').length;
  }
  const total = line.replace(/\s/g, '').length;
  return total > 0 && covered / total >= 0.6 ? tokens : [];
}
