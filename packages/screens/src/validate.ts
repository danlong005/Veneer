// Strict validation of screen definitions from files or the designer API.

import { DATE_FORMATS, ROLES, type Change, type ScreenDefinition, type Target, type TextMatch, type Widget } from './types.ts';

export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const AID = /^(Enter|Help|PageUp|PageDown|Print|Clear|RecordBackspace|F([1-9]|1\d|2[0-4]))$/;
const FIELD_ID = /^\d{1,3}:\d{1,3}$/;
const MAX_CHANGES = 500;

export class DefinitionError extends Error {
  override name = 'DefinitionError';
}

type Obj = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new DefinitionError(`${path}: ${message}`);
}

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'must be an object');
  return v as Obj;
}

function str(v: unknown, path: string, max = 200): string {
  if (typeof v !== 'string' || v.length > max) fail(path, `must be a string of at most ${max} characters`);
  return v;
}

function int(v: unknown, path: string, min: number, max: number): number {
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) fail(path, `must be an integer ${min}-${max}`);
  return v as number;
}

function arr(v: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(v) || v.length > max) fail(path, `must be an array of at most ${max} items`);
  return v;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) fail(path, `must be one of ${allowed.join(', ')}`);
  return v as T;
}

function target(v: unknown, path: string): Target {
  const o = obj(v, path);
  return { row: int(o.row, `${path}.row`, 1, 27), col: int(o.col, `${path}.col`, 1, 132) };
}

function textMatch(v: unknown, path: string): TextMatch {
  const o = obj(v, path);
  const text = str(o.text, `${path}.text`, 132);
  if (text.trim() === '') fail(`${path}.text`, 'must not be blank');
  return { ...target(o, path), text };
}

function widget(v: unknown, path: string): Widget {
  const o = obj(v, path);
  switch (o.type) {
    case 'select':
      return {
        type: 'select',
        options: arr(o.options, `${path}.options`, 200).map((x, i) => {
          const opt = obj(x, `${path}.options[${i}]`);
          return { value: str(opt.value, `${path}.options[${i}].value`, 132), label: str(opt.label, `${path}.options[${i}].label`) };
        }),
      };
    case 'checkbox':
      return { type: 'checkbox', on: str(o.on, `${path}.on`, 132), off: str(o.off, `${path}.off`, 132) };
    case 'date':
      return { type: 'date', format: oneOf(o.format, DATE_FORMATS, `${path}.format`) };
    default:
      fail(`${path}.type`, 'must be select, checkbox or date');
  }
}

function change(v: unknown, path: string): Change {
  const o = obj(v, path);
  switch (o.op) {
    case 'hide': return { op: 'hide', at: target(o.at, `${path}.at`) };
    case 'text': return { op: 'text', at: target(o.at, `${path}.at`), text: str(o.text, `${path}.text`) };
    case 'role': return { op: 'role', at: target(o.at, `${path}.at`), role: oneOf(o.role, ROLES, `${path}.role`) };
    case 'widget': {
      const field = str(o.field, `${path}.field`, 7);
      if (!FIELD_ID.test(field)) fail(`${path}.field`, 'must be a field id like "6:53"');
      return { op: 'widget', field, widget: widget(o.widget, `${path}.widget`) };
    }
    case 'button': {
      const a = obj(o.action, `${path}.action`);
      const aid = str(a.aid, `${path}.action.aid`, 20);
      if (!AID.test(aid)) fail(`${path}.action.aid`, 'must be an AID key such as Enter or F3');
      const action: Extract<Change, { op: 'button' }>['action'] = { aid: aid as never };
      if (a.fields !== undefined) {
        const f = obj(a.fields, `${path}.action.fields`);
        action.fields = {};
        for (const [id, value] of Object.entries(f)) {
          if (!FIELD_ID.test(id)) fail(`${path}.action.fields`, `"${id.slice(0, 20)}" is not a field id`);
          action.fields[id] = str(value, `${path}.action.fields["${id}"]`, 132);
        }
      }
      return { op: 'button', label: str(o.label, `${path}.label`, 60), action };
    }
    default:
      fail(`${path}.op`, 'must be hide, text, role, widget or button');
  }
}

/** Validate untrusted input; returns a clean definition (unknown keys dropped). */
export function validateDefinition(input: unknown): ScreenDefinition {
  const o = obj(input, 'definition');
  const id = str(o.id, 'id', 64);
  if (!ID_PATTERN.test(id)) fail('id', 'must be lowercase letters, digits and dashes');
  const name = str(o.name, 'name', 100);
  if (name.trim() === '') fail('name', 'must not be blank');
  const m = obj(o.match, 'match');
  const text = arr(m.text, 'match.text', 20).map((x, i) => textMatch(x, `match.text[${i}]`));
  if (text.length === 0) fail('match.text', 'needs at least one text condition');
  const def: ScreenDefinition = {
    id,
    name,
    match: {
      ...(m.rows !== undefined ? { rows: int(m.rows, 'match.rows', 24, 27) } : {}),
      ...(m.cols !== undefined ? { cols: int(m.cols, 'match.cols', 80, 132) } : {}),
      text,
    },
    changes: arr(o.changes ?? [], 'changes', MAX_CHANGES).map((x, i) => change(x, `changes[${i}]`)),
  };
  if (o.title !== undefined) def.title = str(o.title, 'title', 100);
  return def;
}
