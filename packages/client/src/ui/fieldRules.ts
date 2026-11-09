// Field rules applied in the browser: allowed characters, the 5250 Field+/
// Field- keys, and the mandatory checks a terminal makes before Enter.
// 3270 numeric fields take what a 3270's numeric lock lets through.

import type { FieldSnapshot } from '@veneer/terminal';
import { monocase } from '@veneer/terminal';
import { acceptsChar } from '@veneer/view';

// The rules the server's macro runs use too live in @veneer/view.
export { acceptsChar, checkFields, filterValue, isNumeric, takesNumbers, type FieldProblem } from '@veneer/view';

/**
 * Typing over (a 3270 with Insert off): the character at the caret is
 * replaced. Null when the field refuses the character; past the end of the
 * value, typing is ordinary.
 */
export function overtyped(f: FieldSnapshot, value: string, at: number, ch: string): string | null {
  const c = f.monocase ? monocase(ch) : ch;
  if (!acceptsChar(f, c)) return null;
  return (value.slice(0, at) + c + value.slice(at + 1)).slice(0, f.length);
}

/** Erase EOF: the value up to the caret. */
export function erasedToEnd(value: string, at: number): string {
  return value.slice(0, Math.max(0, at));
}

/** Erase Input: every input field blank. */
export function erasedInput(fields: FieldSnapshot[]): Record<string, string> {
  return Object.fromEntries(fields.filter((f) => !f.bypass).map((f) => [f.id, '']));
}

/** Field+ / Field-: set the sign of a numeric value ("123" -> "123-"). */
export function withSign(value: string, negative: boolean): string {
  const digits = value.trim().replace(/^[-+]|[-+]$/, '').trim();
  return negative && digits ? `${digits}-` : digits;
}

/**
 * Fields this short (option and selection columns) get tight padding, so their
 * box covers only their characters and the blank attribute byte after them and
 * never the text that follows.
 */
export const SHORT_FIELD = 3;
export const isShortField = (f: Pick<FieldSnapshot, 'length'>): boolean => f.length <= SHORT_FIELD;

/** The CSS width of a field in a table cell. */
export function cellInputWidth(f: Pick<FieldSnapshot, 'length'>): string {
  const n = Math.max(f.length, 1);
  return isShortField(f) ? `calc(${n + 1} * var(--cw))` : `calc(${n} * var(--cw) + 1.2em)`;
}
