// Field rules applied in the browser: allowed characters, the 5250 Field+/
// Field- keys, and the mandatory checks a terminal makes before Enter.
// 3270 numeric fields take what a 3270's numeric lock lets through.

import type { FieldSnapshot } from '@veneer/terminal';
import { monocase } from '@veneer/terminal';

const NUMERIC_CHARS = /^[0-9 ,.+-]$/;
/**
 * Signed numeric fields take digits only, as on a terminal: the decimal point
 * is implied by the field (type 1250 for 12.50), and IBM i rejects the
 * record (CPF0886) if one is sent. The sign is typed or set with Field+/Field-.
 */
const SIGNED_CHARS = /^[0-9+-]$/;
/** A 3270 numeric field: digits, the decimal point and a minus sign. */
const NUMERIC_3270_CHARS = /^[0-9.-]$/;

/** 5250 signed and numeric-only fields: right-aligned, numbers and signs only, with Field+/Field-. */
export function isNumeric(f: FieldSnapshot): boolean {
  return f.shift === 'numericOnly' || f.shift === 'signedNumeric';
}

/** Fields that take a number of some kind: 5250 numeric and digits-only fields, and 3270 numeric ones. */
export function takesNumbers(f: FieldSnapshot): boolean {
  return isNumeric(f) || f.shift === 'digitsOnly' || f.numeric === true;
}

export function acceptsChar(f: FieldSnapshot, ch: string): boolean {
  if (f.numeric) return NUMERIC_3270_CHARS.test(ch);
  if (f.shift === 'signedNumeric') return SIGNED_CHARS.test(ch);
  if (f.shift === 'numericOnly') return NUMERIC_CHARS.test(ch);
  if (f.shift === 'digitsOnly') return ch >= '0' && ch <= '9';
  return true;
}

/** Drop characters the field does not accept. */
export function filterValue(f: FieldSnapshot, value: string): string {
  return [...value].filter((ch) => acceptsChar(f, ch)).join('');
}

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

export interface FieldProblem {
  id: string;
  message: string;
}

/** The checks a 5250 makes before sending Enter: mandatory entry and mandatory fill. */
export function checkFields(fields: FieldSnapshot[], edits: Record<string, string>): FieldProblem | null {
  for (const f of fields) {
    if (f.bypass) continue;
    const edited = f.id in edits && edits[f.id] !== f.value;
    const value = edits[f.id] ?? f.value;
    if (f.mandatoryEnter && !f.modified && !edited) {
      return { id: f.id, message: 'This field requires an entry.' };
    }
    const length = value.replace(/\s+$/, '').length;
    if (f.adjust === 'mandatoryFill' && length > 0 && length < f.length) {
      return { id: f.id, message: `This field must be completely filled (${f.length} characters).` };
    }
  }
  return null;
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
