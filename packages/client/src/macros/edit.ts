// Macros in the browser: recording what a user does into steps, editing a
// macro in the designer, the check each typed value gets, and deep links.
// The runner itself is MacroRun in @veneer/screens.

import {
  PARAM_NAME, RESERVED_PARAMS, paramsIn, screenId, valueAt, type FieldCheck, type Macro, type MacroCheck, type MacroEnd, type MacroStep,
} from '@veneer/screens';
import type { AidName, FieldSnapshot, ScreenSnapshot } from '@veneer/terminal';
import { typingProblem } from '@veneer/view';

/**
 * One recorded step: the screen a key was pressed on, the fields the user
 * changed, the key, and the cursor if it is not where the host put it.
 * Hidden fields (passwords) are never recorded.
 */
export function recordStep(
  snap: ScreenSnapshot, title: string | undefined, aid: AidName, sent: Record<string, string>, cursor: { row: number; col: number },
): MacroStep {
  const fields: Record<string, string> = {};
  for (const [id, value] of Object.entries(sent)) {
    const f = snap.fields.find((x) => x.id === id);
    if (f && !f.bypass && !f.attr.nonDisplay) fields[id] = value;
  }
  // Enter rarely depends on the cursor: after typing it is just where the typing
  // ended, in a field typed into or the one the host put the cursor in. Other
  // keys keep it (F4 prompts for the field the cursor is in).
  const home = snap.fields.find((f) => !f.bypass && inField(snap, f, snap.cursor));
  const typing = aid === 'Enter' && snap.fields.some((f) => (fields[f.id] !== undefined || f === home) && inField(snap, f, cursor));
  const moved = (cursor.row !== snap.cursor.row || cursor.col !== snap.cursor.col) && !typing;
  return {
    screen: screenId(snap),
    ...(title ? { title: title.slice(0, 132) } : {}),
    ...(Object.keys(fields).length > 0 ? { fields } : {}),
    ...(moved ? { cursor: { row: cursor.row, col: cursor.col } } : {}),
    press: aid,
  };
}

/** Whether a position is in a field, or just after its last character (where a caret ends after typing). */
function inField(snap: ScreenSnapshot, f: FieldSnapshot, at: { row: number; col: number }): boolean {
  const start = (f.row - 1) * snap.cols + f.col - 1;
  const pos = (at.row - 1) * snap.cols + at.col - 1;
  return pos >= start && pos <= start + f.length;
}

/** A new macro from recorded steps, and the screen it must end on if checks were added there. */
export function newMacro(steps: MacroStep[], host: Macro['host'], taken: readonly string[], end?: MacroEnd): Macro {
  let n = 1;
  while (taken.includes(`macro-${n}`)) n++;
  return { name: `macro-${n}`, label: `Macro ${n}`, ...(host ? { host } : {}), steps, ...(end ? { end } : {}) };
}

// ---- checks (MacroCheck): what a screen must show, on a step (expect) or at the end

/**
 * Checks added while recording, on the screen showing: they go on the step
 * recorded when a key is pressed on it, or become the end if recording stops there.
 */
export interface RecordedChecks {
  screen: string;
  title?: string;
  expect: MacroCheck[];
}

/** A check that the value at a position is what it is now: a field's value, or the text there to the next wide gap. */
export function checkAt(snap: ScreenSnapshot, at: { row: number; col: number }): MacroCheck {
  const pos = `${at.row}:${at.col}`;
  return { at: pos, equals: valueAt(snap, pos), ...labelFor(snap, at) };
}

/** A check on the host's message: that it says what it says now, or that there is none. */
export function messageCheck(message: string): MacroCheck {
  const text = message.trim();
  return text ? { message: true, contains: text } : { message: true, equals: '' };
}

/**
 * A name for the value at a position, from the label before it on the row:
 * "Status . . . :  DLV" gives "Status". None when there is no text before it.
 */
function labelFor(snap: ScreenSnapshot, at: { row: number; col: number }): { label?: string } {
  const before = (snap.lines[at.row - 1] ?? '').slice(0, at.col - 1);
  const label = before.split(/\s{2,}/).filter((t) => t.trim()).at(-1)?.replace(/[\s.:]+$/, '').trim() ?? '';
  return label && /[A-Za-z]/.test(label) ? { label: label.slice(0, 60) } : {};
}

export type CheckTest = 'equals' | 'contains' | 'matches';

export function testOf(c: MacroCheck): CheckTest {
  return c.equals !== undefined ? 'equals' : c.contains !== undefined ? 'contains' : 'matches';
}

/** The check with another test, keeping the value it tests against. */
export function setTest(c: MacroCheck, test: CheckTest, value = c[testOf(c)] ?? ''): MacroCheck {
  const { equals: _e, contains: _c, matches: _m, ...rest } = c;
  return { ...rest, [test]: value };
}

/** The checks of step i, or of the end (i = 'end'), replaced. An end with nothing left goes. */
export function setChecks(macro: Macro, where: number | 'end', checks: MacroCheck[]): Macro {
  if (where === 'end') {
    const { expect: _x, ...end } = macro.end ?? {};
    return setEnd(macro, checks.length ? { ...end, expect: checks } : end);
  }
  return { ...macro, steps: macro.steps.map((s, k) => {
    if (k !== where) return s;
    const { expect: _x, ...rest } = s;
    return checks.length ? { ...rest, expect: checks } : rest;
  }) };
}

export function checksOf(macro: Macro, where: number | 'end'): MacroCheck[] {
  return (where === 'end' ? macro.end?.expect : macro.steps[where]?.expect) ?? [];
}

/** The end: the screen it must end on and its checks; left out of the macro when empty. */
export function setEnd(macro: Macro, end: MacroEnd): Macro {
  const { end: _e, ...rest } = macro;
  return end.screen || end.text?.length || end.expect?.length ? { ...rest, end } : rest;
}

/** It must end on this screen (with its title), keeping the end's checks. */
export function endHere(macro: Macro, snap: ScreenSnapshot, title: string | undefined): Macro {
  const { text: _t, title: _old, ...end } = macro.end ?? {};
  return setEnd(macro, { ...end, screen: screenId(snap), ...(title ? { title: title.slice(0, 132) } : {}) });
}

/** It may end on any screen; its checks stay. */
export function endAnywhere(macro: Macro): Macro {
  const { screen: _s, text: _t, title: _old, ...end } = macro.end ?? {};
  return setEnd(macro, end);
}

/** A macro's file name from its label: "Order inquiry" -> "order-inquiry". */
export function nameFor(label: string): string {
  const name = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return name || 'macro';
}

/** Why a parameter name can't be used, or undefined. */
export function paramNameProblem(macro: Macro, name: string): string | undefined {
  if (!PARAM_NAME.test(name)) return 'Use letters, digits and _, starting with a letter.';
  if ((RESERVED_PARAMS as readonly string[]).includes(name.toLowerCase())) return `“${name}” is reserved.`;
  if (macro.params?.[name]) return `There is already a parameter called ${name}.`;
  return undefined;
}

/**
 * Turn a typed value into a parameter: the field's value becomes {name}, and
 * the parameter is declared, required, with the recorded value as its example.
 */
export function makeParameter(macro: Macro, step: number, field: string, name: string): Macro {
  const steps = macro.steps.map((s, i) => (i === step && s.fields?.[field] !== undefined
    ? { ...s, fields: { ...s.fields, [field]: `{${name}}` } } : s));
  return { ...macro, params: { ...macro.params, [name]: { required: true } }, steps };
}

/** Remove a parameter, putting `value` back where it was used. */
export function removeParameter(macro: Macro, name: string, value = ''): Macro {
  const { [name]: _gone, ...params } = macro.params ?? {};
  const steps = macro.steps.map((s) => (s.fields
    ? { ...s, fields: Object.fromEntries(Object.entries(s.fields).map(([id, v]) => [id, v.split(`{${name}}`).join(value)])) } : s));
  const out: Macro = { ...macro, steps };
  if (Object.keys(params).length > 0) out.params = params; else delete out.params;
  return out;
}

/** Parameters no step uses any more. */
export function unusedParams(macro: Macro): string[] {
  const used = new Set(macro.steps.flatMap((s) => Object.values(s.fields ?? {}).flatMap(paramsIn)));
  return Object.keys(macro.params ?? {}).filter((p) => !used.has(p));
}

export function setStep(macro: Macro, i: number, step: MacroStep): Macro {
  return { ...macro, steps: macro.steps.map((s, k) => (k === i ? step : s)) };
}

export function removeStep(macro: Macro, i: number): Macro {
  return { ...macro, steps: macro.steps.filter((_, k) => k !== i) };
}

/** Move a step up (-1) or down (+1). */
export function moveStep(macro: Macro, i: number, by: -1 | 1): Macro {
  const j = i + by;
  if (j < 0 || j >= macro.steps.length) return macro;
  const steps = [...macro.steps];
  [steps[i], steps[j]] = [steps[j]!, steps[i]!];
  return { ...macro, steps };
}

/** The address that starts a macro in a new session, with example values. */
export function deepLink(macro: Macro, origin: string, values: Readonly<Record<string, string>> = {}): string {
  const q = new URLSearchParams({ macro: macro.name });
  for (const name of Object.keys(macro.params ?? {})) q.set(name, values[name] ?? '');
  return `${origin}/?${q.toString()}`;
}

/**
 * The macro API's named values: change the k-th one's name and position, or
 * remove it (name null). Order is kept, so renaming doesn't move it.
 */
export function setOutput(macro: Macro, k: number, name: string | null, at: string): Macro {
  const entries = Object.entries(macro.output ?? {});
  // Another value's name would merge the two: refuse it, as the field can't hold it.
  if (name !== null && entries.some(([n], i) => i !== k && n === name)) return macro;
  if (name === null) entries.splice(k, 1);
  else entries[k] = [name, at];
  const { output: _o, ...rest } = macro;
  return entries.length ? { ...rest, output: Object.fromEntries(entries) } : rest;
}

/** A new named value at a position, under the first free name value1, value2, ... */
export function addOutput(macro: Macro, at: string): Macro {
  const taken = new Set(Object.keys(macro.output ?? {}));
  let n = 1;
  while (taken.has(`value${n}`)) n++;
  return { ...macro, output: { ...macro.output, [`value${n}`]: at } };
}

/** A deep link in the page address: the macro's name and the values given. */
export function linkedMacro(search: string): { name: string; given: Record<string, string> } | null {
  const q = new URLSearchParams(search);
  const name = q.get('macro');
  if (!name) return null;
  q.delete('macro');
  return { name, given: Object.fromEntries(q) };
}

/** The browser's own field rules for a value a macro types: what a user could not type, a macro can't either. */
export const macroFieldCheck: FieldCheck = typingProblem;
