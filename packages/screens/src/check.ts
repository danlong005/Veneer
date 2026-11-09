// Checks of the screens folder for CI: definitions and macros against each
// other and against recorded screens (snapshots/<name>.json), so a display
// file recompiled with a new layout shows up as a failed check instead of a
// customization that silently stops applying.
//
// A recorded screen is the screen's shape and protected text as the designer
// saw it, with what was typed into input fields left out. Recorded for a
// definition, it is the screen that definition must keep matching; the
// others are screens macros pass through.

import type { FieldSnapshot, ScreenSnapshot } from '@veneer/terminal';
import { fingerprint, screenId } from './fingerprint.ts';
import { matches, matchScreen, textMatches } from './match.ts';
import { paramsIn, stepMatches, type Macro } from './macros.ts';
import type { Change, ScreenDefinition, Target } from './types.ts';
import { ID_PATTERN, arr, fail, int, obj, str } from './validate.ts';

export interface Recording {
  /** File name: snapshots/<name>.json. */
  name: string;
  /** The definition this is the screen of, which must keep matching it. */
  definition?: string;
  /** When it was recorded (ISO time). */
  recorded?: string;
  screen: ScreenSnapshot;
}

export type CheckLevel = 'error' | 'warning';

export interface CheckFinding {
  level: CheckLevel;
  /** The file the finding is about, relative to the screens folder. */
  file: string;
  message: string;
}

export interface CheckInput {
  definitions: readonly ScreenDefinition[];
  macros: readonly Macro[];
  recordings: readonly Recording[];
}

export const RECORDINGS_DIR = 'snapshots';
const MAX_ROWS = 43;
const MAX_COLS = 132;
const FIELD_ID = /^\d{1,3}:\d{1,3}$/;

export const definitionFile = (id: string) => `${id}.json`;
export const macroFile = (name: string) => `macros/${name}.json`;
export const recordingFile = (name: string) => `${RECORDINGS_DIR}/${name}.json`;

/**
 * The screen as it is kept in a recording: only what identifies and matches
 * it. Input fields are blanked (values, and their text on the screen), so
 * nothing a user typed is saved.
 */
export function recordScreen(snap: ScreenSnapshot): ScreenSnapshot {
  const lines = snap.lines.map((l) => [...l.padEnd(snap.cols, ' ')]);
  const segments = snap.segments.map((row) => row.map((s) => ({ col: s.col, text: [...s.text], attr: { ...s.attr } })));
  const fields: FieldSnapshot[] = snap.fields.map((f) => {
    if (f.bypass) return { ...f, attr: { ...f.attr }, modified: false };
    for (let i = 0; i < f.length; i++) {
      const at = (f.row - 1) * snap.cols + (f.col - 1) + i;
      const r = Math.floor(at / snap.cols) % snap.rows;
      const c = (at % snap.cols) + 1;
      if (lines[r]) lines[r]![c - 1] = ' ';
      for (const s of segments[r] ?? []) if (c >= s.col && c < s.col + s.text.length) s.text[c - s.col] = ' ';
    }
    return { ...f, attr: { ...f.attr }, value: '', modified: false };
  });
  return {
    host: snap.host, rows: snap.rows, cols: snap.cols,
    cursor: { row: 1, col: 1 }, keyboardLocked: false, messageWaiting: false, error: null,
    ...(snap.messageRow !== undefined ? { messageRow: snap.messageRow } : {}),
    lines: lines.map((l, i) => l.join('').slice(0, snap.lines[i]!.length)),
    segments: segments.map((row) => row.map((s) => ({ col: s.col, text: s.text.join(''), attr: s.attr }))),
    fields,
  };
}

/** A recording from a file or the designer API. Throws DefinitionError. */
export function validateRecording(input: unknown): Recording {
  const o = obj(input, 'recording');
  const name = str(o.name, 'name', 64);
  if (!ID_PATTERN.test(name)) fail('name', 'must be lowercase letters, digits and dashes');
  let definition: string | undefined;
  if (o.definition !== undefined) {
    definition = str(o.definition, 'definition', 64);
    if (!ID_PATTERN.test(definition)) fail('definition', 'must be a definition id');
  }
  const recorded = o.recorded !== undefined ? str(o.recorded, 'recorded', 40) : undefined;
  return { name, ...(definition ? { definition } : {}), ...(recorded ? { recorded } : {}), screen: screenShape(o.screen) };
}

function screenShape(v: unknown): ScreenSnapshot {
  const o = obj(v, 'screen');
  if (o.host !== '5250' && o.host !== '3270') fail('screen.host', 'must be "5250" or "3270"');
  const rows = int(o.rows, 'screen.rows', 1, MAX_ROWS);
  const cols = int(o.cols, 'screen.cols', 1, MAX_COLS);
  const lines = arr(o.lines, 'screen.lines', rows).map((l, i) => str(l, `screen.lines[${i}]`, cols));
  const segments = arr(o.segments, 'screen.segments', rows).map((row, i) => arr(row, `screen.segments[${i}]`, cols).map((x, j) => {
    const p = `screen.segments[${i}][${j}]`;
    const s = obj(x, p);
    return { col: int(s.col, `${p}.col`, 1, cols), text: str(s.text, `${p}.text`, cols), attr: obj(s.attr, `${p}.attr`) };
  }));
  const fields = arr(o.fields, 'screen.fields', rows * cols).map((x, i) => {
    const p = `screen.fields[${i}]`;
    const f = obj(x, p);
    const id = str(f.id, `${p}.id`, 7);
    if (!FIELD_ID.test(id)) fail(`${p}.id`, 'must be a field id like "6:53"');
    int(f.row, `${p}.row`, 1, rows);
    int(f.col, `${p}.col`, 1, cols);
    int(f.length, `${p}.length`, 0, rows * cols);
    if (typeof f.bypass !== 'boolean') fail(`${p}.bypass`, 'must be true or false');
    obj(f.attr, `${p}.attr`);
    return f;
  });
  const messageRow = o.messageRow !== undefined ? int(o.messageRow, 'screen.messageRow', 1, rows) : undefined;
  return {
    host: o.host, rows, cols,
    cursor: { row: 1, col: 1 }, keyboardLocked: false, messageWaiting: false, error: null,
    ...(messageRow !== undefined ? { messageRow } : {}),
    lines, segments, fields,
  } as unknown as ScreenSnapshot;
}

/** Everything wrong with the folder's definitions and macros, errors first. */
export function checkScreens(input: CheckInput): CheckFinding[] {
  const out: CheckFinding[] = [];
  const macros = new Map(input.macros.map((m) => [m.name, m]));
  const definitionIds = new Set(input.definitions.map((d) => d.id));
  for (const def of input.definitions) checkDefinition(def, input, macros, out);
  for (const macro of input.macros) checkMacro(macro, input.recordings, out);
  for (const r of input.recordings) {
    if (r.definition && !definitionIds.has(r.definition)) {
      out.push({ level: 'warning', file: recordingFile(r.name), message: `It was recorded for the definition "${r.definition}", which doesn't exist.` });
    }
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
}

function checkDefinition(def: ScreenDefinition, input: CheckInput, macros: Map<string, Macro>, out: CheckFinding[]): void {
  const file = definitionFile(def.id);
  const error = (message: string) => out.push({ level: 'error', file, message });
  const warn = (message: string) => out.push({ level: 'warning', file, message });

  // Buttons that run macros need the macro, and values for what it requires.
  for (const c of def.changes) {
    if (c.op !== 'button' || !('macro' in c.action)) continue;
    const macro = macros.get(c.action.macro);
    if (!macro) { error(`The button “${c.label}” runs the macro "${c.action.macro}", which doesn't exist.`); continue; }
    const given = c.action.params ?? {};
    for (const name of Object.keys(given)) {
      if (!macro.params?.[name]) error(`The button “${c.label}” gives the macro "${macro.name}" a value for "${name}", which isn't one of its parameters.`);
    }
    for (const [name, p] of Object.entries(macro.params ?? {})) {
      if (p.required && !given[name]) error(`The button “${c.label}” doesn't give the macro "${macro.name}" its required "${name}".`);
    }
  }

  // The screens it is checked against: those recorded for it, else any it is used on.
  const own = input.recordings.filter((r) => r.definition === def.id);
  for (const r of own) {
    const why = mismatch(def, r.screen);
    if (why) { error(`It no longer matches its recorded screen (${recordingFile(r.name)}): ${why}`); continue; }
    const winner = matchScreen(r.screen, input.definitions);
    if (winner && winner.id !== def.id) error(`Its recorded screen (${recordingFile(r.name)}) is customized by "${winner.id}" instead, which matches it more closely.`);
  }
  const screens = own.length > 0
    ? own.filter((r) => matches(r.screen, def) && matchScreen(r.screen, input.definitions)?.id === def.id)
    : input.recordings.filter((r) => matchScreen(r.screen, input.definitions)?.id === def.id);
  if (own.length === 0 && screens.length === 0) {
    // With nothing recorded at all, the report says so once instead.
    if (input.recordings.length > 0) warn('No recorded screen matches it, so its fields can\'t be checked. Record its screen in the designer.');
    return;
  }
  if (screens.length === 0) return;
  const snaps = screens.map((r) => r.screen);

  for (const ref of fieldRefs(def.changes)) {
    if (!snaps.some((s) => inputField(s, ref.id))) error(`${ref.what} names the input field at ${ref.id}, which isn't on the recorded screen${snaps.length > 1 ? 's' : ''}.`);
  }
  for (const ref of positionRefs(def.changes)) {
    if (!snaps.some((s) => somethingAt(s, ref.at))) warn(`${ref.what} is at ${ref.at.row}:${ref.at.col}, where the recorded screen${snaps.length > 1 ? 's have' : ' has'} nothing.`);
  }
  for (const ref of columnRefs(def.changes)) {
    if (!snaps.some((s) => s.lines.some((l) => l.toLowerCase().includes(ref.column.toLowerCase())))) {
      warn(`${ref.what} uses the column “${ref.column}”, whose heading isn't on the recorded screen${snaps.length > 1 ? 's' : ''}.`);
    }
  }
}

/** Why a definition doesn't match a screen, for people; undefined when it does. */
export function mismatch(def: ScreenDefinition, snap: ScreenSnapshot): string | undefined {
  const { rows, cols, text, screenIds = [] } = def.match;
  if (def.host !== undefined && def.host !== snap.host) return `the screen is from a ${snap.host === '3270' ? 'mainframe' : 'IBM i'}.`;
  if ((rows !== undefined && rows !== snap.rows) || (cols !== undefined && cols !== snap.cols)) {
    return `the screen is ${snap.rows}x${snap.cols}, not ${rows ?? snap.rows}x${cols ?? snap.cols}.`;
  }
  if (screenIds.length > 0) {
    const print = fingerprint(snap);
    if (!screenIds.includes(print.id)) {
      return `its screen ID is now ${print.id}${print.title ? ` (“${print.title}”)` : ''}, not ${screenIds.join(' or ')}. The screen's layout or title changed.`;
    }
  }
  for (const m of text) {
    if (!textMatches(snap, m)) {
      const found = (snap.lines[m.row - 1] ?? '').slice(m.col - 1, m.col - 1 + m.text.length).trim();
      return `“${m.text}” is not at ${m.row}:${m.col}${found ? ` (“${found}” is)` : ''}.`;
    }
  }
  return matches(snap, def) ? undefined : 'it has no screen IDs or text to match.';
}

function checkMacro(macro: Macro, recordings: readonly Recording[], out: CheckFinding[]): void {
  const file = macroFile(macro.name);
  const unrecorded: number[] = [];
  macro.steps.forEach((step, i) => {
    const n = i + 1;
    const called = step.title ? `the “${step.title}” screen` : `screen ${step.screen}`;
    const seen = recordings.filter((r) => stepMatches(step, r.screen));
    if (seen.length === 0) {
      // A recorded screen with the step's title but another ID: the layout changed.
      const same = step.title ? recordings.find((r) => (!macro.host || r.screen.host === macro.host) && hasTitle(r.screen, step.title!)) : undefined;
      if (same) {
        const now = screenId(same.screen);
        out.push({
          level: 'error', file,
          message: now === step.screen
            ? `Step ${n} expects ${called}, but its text no longer matches the recording (${recordingFile(same.name)}).`
            : `Step ${n} expects ${called} with screen ID ${step.screen}, but it is recorded (${recordingFile(same.name)}) with ${now}. Record the macro again.`,
        });
      } else unrecorded.push(n);
      return;
    }
    for (const [id, template] of Object.entries(step.fields ?? {})) {
      const fields = seen.map((r) => inputField(r.screen, id));
      const field = fields.find((f) => f !== undefined);
      if (!field) { out.push({ level: 'error', file, message: `Step ${n} types into the field at ${id}, which isn't an input field on ${called}.` }); continue; }
      if (paramsIn(template).length === 0 && template.length > field.length) {
        out.push({ level: 'error', file, message: `Step ${n} types “${template}” into the field at ${id}, which takes ${field.length} characters.` });
      }
    }
  });
  if (unrecorded.length > 0 && recordings.length > 0) {
    const steps = unrecorded.length === 1 ? `Step ${unrecorded[0]}'s screen isn't` : `The screens of steps ${unrecorded.join(', ')} aren't`;
    out.push({ level: 'warning', file, message: `${steps} recorded, so ${unrecorded.length === 1 ? 'it' : 'they'} can't be checked.` });
  }
}

/** The screen's title is `title`: the one in its screen ID, or text near the top (step titles are the page title shown). */
function hasTitle(snap: ScreenSnapshot, title: string): boolean {
  const t = title.trim();
  return t !== '' && (fingerprint(snap).title === t || snap.lines.slice(0, 3).some((l) => l.includes(t)));
}

function inputField(snap: ScreenSnapshot, id: string): FieldSnapshot | undefined {
  return snap.fields.find((f) => f.id === id && !f.bypass);
}

/** Text or a field starts at the position. */
function somethingAt(snap: ScreenSnapshot, at: Target): boolean {
  const ch = snap.lines[at.row - 1]?.[at.col - 1];
  return (ch !== undefined && ch !== ' ') || snap.fields.some((f) => f.row === at.row && f.col === at.col);
}

interface FieldRef { id: string; what: string }
interface PositionRef { at: Target; what: string }
interface ColumnRef { column: string; what: string }

const WHAT: Partial<Record<Change['op'], string>> = { hide: 'A hidden item', text: 'A text change', role: 'A color change', move: 'A moved item', display: 'A display', style: 'A style rule' };

function fieldRefs(changes: readonly Change[]): FieldRef[] {
  const out: FieldRef[] = [];
  for (const c of changes) {
    if (c.op === 'widget') {
      out.push({ id: c.field, what: `The ${c.widget.type} widget` });
      if (c.widget.type === 'textarea') for (const id of c.widget.fields.slice(1)) out.push({ id, what: 'The text area' });
    } else if (c.op === 'component' && c.field) out.push({ id: c.field, what: `The component "${c.name}"` });
    else if (c.op === 'button' && 'aid' in c.action) {
      for (const id of Object.keys(c.action.fields ?? {})) out.push({ id, what: `The button “${c.label}”` });
    }
  }
  return out;
}

function positionRefs(changes: readonly Change[]): PositionRef[] {
  const out: PositionRef[] = [];
  for (const c of changes) {
    const what = WHAT[c.op];
    if (!what) continue;
    if (c.op === 'style') { if (c.when.at) out.push({ at: c.when.at, what }); }
    else if ('at' in c && c.at) out.push({ at: c.at, what });
  }
  return out;
}

function columnRefs(changes: readonly Change[]): ColumnRef[] {
  const out: ColumnRef[] = [];
  for (const c of changes) {
    if (c.op === 'style' && c.when.column) out.push({ column: c.when.column, what: 'A style rule' });
    if (c.op === 'display' && c.column) out.push({ column: c.column, what: 'A display' });
  }
  return out;
}
