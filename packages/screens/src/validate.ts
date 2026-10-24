// Strict validation of screen definitions from files or the designer API.

import { DATE_FORMATS, ROLES, SCREEN_EVENTS, SITE_EVENTS, type Change, type ScreenEvent, type SiteCustomization, type ScreenDefinition, type Target, type TextMatch, type Widget } from './types.ts';

export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const AID = /^(Enter|Help|PageUp|PageDown|Print|Clear|RecordBackspace|F([1-9]|1\d|2[0-4]))$/;
const FIELD_ID = /^\d{1,3}:\d{1,3}$/;
const SCREEN_ID = /^[0-9a-f]{8,32}$/;
const MAX_CHANGES = 500;
/** Limits for custom code, in characters. */
export const MAX_CSS = 64 * 1024;
export const MAX_SCRIPT = 64 * 1024;
export const MAX_HTML = 16 * 1024;

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
    case 'html':
      return {
        op: 'html',
        at: target(o.at, `${path}.at`),
        html: str(o.html, `${path}.html`, MAX_HTML),
        width: int(o.width, `${path}.width`, 1, 132),
        height: int(o.height, `${path}.height`, 1, 27),
        ...(o.css !== undefined && o.css !== '' ? { css: str(o.css, `${path}.css`, MAX_CSS) } : {}),
        ...(o.script !== undefined && o.script !== '' ? { script: str(o.script, `${path}.script`, MAX_SCRIPT) } : {}),
      };
    default:
      fail(`${path}.op`, 'must be hide, text, role, widget, button or html');
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
  const text = arr(m.text ?? [], 'match.text', 20).map((x, i) => textMatch(x, `match.text[${i}]`));
  const screenIds = arr(m.screenIds ?? [], 'match.screenIds', 20).map((x, i) => {
    const sid = str(x, `match.screenIds[${i}]`, 32);
    if (!SCREEN_ID.test(sid)) fail(`match.screenIds[${i}]`, 'must be a screen id (hex digits)');
    return sid;
  });
  if (text.length === 0 && screenIds.length === 0) fail('match', 'needs a screen id or at least one text rule');
  const def: ScreenDefinition = {
    id,
    name,
    match: {
      ...(screenIds.length > 0 ? { screenIds } : {}),
      ...(m.rows !== undefined ? { rows: int(m.rows, 'match.rows', 24, 27) } : {}),
      ...(m.cols !== undefined ? { cols: int(m.cols, 'match.cols', 80, 132) } : {}),
      text,
    },
    changes: arr(o.changes ?? [], 'changes', MAX_CHANGES).map((x, i) => change(x, `changes[${i}]`)),
  };
  if (o.title !== undefined) def.title = str(o.title, 'title', 100);
  if (o.css !== undefined && o.css !== '') def.css = str(o.css, 'css', MAX_CSS);
  const scripts: Partial<Record<ScreenEvent, string>> = {};
  // Older definitions had one `script`, run each time the screen was drawn.
  if (o.script !== undefined && o.script !== '') scripts.show = str(o.script, 'script', MAX_SCRIPT);
  if (o.scripts !== undefined) {
    for (const [event, code] of Object.entries(obj(o.scripts, 'scripts'))) {
      if (!(SCREEN_EVENTS as readonly string[]).includes(event)) fail(`scripts.${event.slice(0, 20)}`, `must be one of ${SCREEN_EVENTS.join(', ')}`);
      if (code !== '') scripts[event as ScreenEvent] = str(code, `scripts.${event}`, MAX_SCRIPT);
    }
  }
  if (Object.keys(scripts).length > 0) def.scripts = scripts;
  return def;
}

/** Validate site-wide CSS and JavaScript from the designer API. */
export function validateSite(input: unknown): SiteCustomization {
  const o = obj(input, 'site');
  const s = obj(o.scripts ?? {}, 'scripts');
  for (const event of Object.keys(s)) {
    if (!(SITE_EVENTS as readonly string[]).includes(event)) fail(`scripts.${event.slice(0, 20)}`, `must be one of ${SITE_EVENTS.join(', ')}`);
  }
  return {
    css: str(o.css ?? '', 'css', MAX_CSS),
    scripts: { load: str(s.load ?? '', 'scripts.load', MAX_SCRIPT), screen: str(s.screen ?? '', 'scripts.screen', MAX_SCRIPT) },
  };
}
