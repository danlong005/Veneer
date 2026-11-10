// Macros: named lists of steps that drive the host to a screen, the way a user
// would. Each step names the screen it expects, the fields to type into and
// the key to press. Stored as screens/macros/<name>.json beside the screen
// definitions, so they are versioned in git with them.
//
// MacroRun (below) decides what to do on each screen; the browser does the
// typing and pressing through the same path as a user, so field rules and
// mandatory checks still apply.

import { hostHasAid, isAidName, type AidName, type FieldSnapshot, type HostType, type ScreenSnapshot } from '@veneer/terminal';
import { screenId } from './fingerprint.ts';
import { textMatches } from './match.ts';
import type { Target, TextMatch } from './types.ts';
import { DefinitionError, ID_PATTERN, SCREEN_ID, arr, fail, int, obj, str, target, textMatch } from './validate.ts';

/** A value the macro is given when it starts: from a deep link, a button or the person testing it. */
export interface MacroParam {
  /** What the designer and error messages call it. */
  label?: string;
  required?: boolean;
  /** A regular expression the whole value must match. */
  pattern?: string;
}

export interface MacroStep {
  /** The screen id (fingerprint.ts) the step expects. */
  screen: string;
  /** Text that must also be on the screen, for screens that share an id. */
  text?: TextMatch[];
  /** The screen's title when recorded, for people reading the macro. */
  title?: string;
  /** Values to type, by field id. `{name}` is a parameter, `{user}` the signed-on user. */
  fields?: Record<string, string>;
  /** Where the cursor is when the key is pressed (F4 prompts depend on it); else where the host put it. */
  cursor?: Target;
  press: AidName;
  /** The screen only sometimes appears (Display Program Messages): when it doesn't, carry on with the next step. */
  optional?: boolean;
  /** What the step's screen must show, checked when it appears, before anything is typed. A failed check stops the run. */
  expect?: MacroCheck[];
}

/**
 * A check of what a screen shows: a field or the text at a position (`at`),
 * or the host's message (`message`), against exactly one of `equals`,
 * `contains` or `matches`. Values are compared without leading and trailing
 * blanks, and case matters.
 */
export interface MacroCheck {
  /** A field id or a position ("6:22"); text at a position runs to the next wide gap. */
  at?: string;
  /** The message line and any error the host shows. */
  message?: true;
  equals?: string;
  contains?: string;
  /** A regular expression the whole value must match. */
  matches?: string;
  /** Passes when the test fails: the message doesn't contain "not found". */
  not?: true;
  /** What results call it ("Status"); else the position or "The message". */
  label?: string;
}

/** The screen a macro must end on, and what it must show. */
export interface MacroEnd {
  /** The screen id it must end on. */
  screen?: string;
  /** Text that must also be on it, for screens that share an id. */
  text?: TextMatch[];
  /** The screen's title, for people reading the macro and for results. */
  title?: string;
  /** Checked on the screen the macro ends on; every check is made, and any failure fails the run. */
  expect?: MacroCheck[];
}

/** One check made during a run. */
export interface CheckResult {
  /** The step whose screen was checked, from 1; left out for the screen the macro ends on. */
  step?: number;
  /** The check in words: Status equals “DLV”. */
  check: string;
  passed: boolean;
  /** What the screen showed. */
  actual: string;
}

export interface Macro {
  /** File name and URL name: lowercase letters, digits and dashes. */
  name: string;
  label: string;
  host?: HostType;
  params?: Record<string, MacroParam>;
  steps: MacroStep[];
  /** Listed under Go to in the page header. */
  menu?: boolean;
  /** Seconds to wait for each step's screen. */
  timeout?: number;
  /** Other systems may run it through the macro API (POST /api/run/<name>). Off unless set. */
  api?: boolean;
  /**
   * For the macro API: values to read from the screen it ends on, by the name
   * the caller gets them under. Each is a field id or a position ("12:40");
   * text at a position runs to the next wide gap.
   */
  output?: Record<string, string>;
  /** The screen the macro must end on and what it must show, for macros used as tests. */
  end?: MacroEnd;
}

export const MAX_STEPS = 50;
export const MAX_CHECKS = 50;
export const MAX_PARAMS = 20;
export const MAX_OUTPUTS = 50;
/** The longest value a parameter can have. */
export const MAX_PARAM_VALUE = 256;
export const DEFAULT_MACRO_TIMEOUT = 30;
export const PARAM_NAME = /^[a-z][a-z0-9_]{0,31}$/i;
/** Names a macro's own parameters can't use: {user} is the signed-on user; macro names the macro in a URL. */
export const RESERVED_PARAMS = ['user', 'macro'] as const;

const FIELD_ID = /^\d{1,3}:\d{1,3}$/;
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]{0,31})\}/g;

/** The parameter names a value refers to. */
export function paramsIn(value: string): string[] {
  return [...value.matchAll(PLACEHOLDER)].map((m) => m[1]!);
}

export function validateMacro(input: unknown): Macro {
  const o = obj(input, 'macro');
  const name = str(o.name, 'name', 64);
  if (!ID_PATTERN.test(name)) fail('name', 'must be lowercase letters, digits and dashes');
  const label = str(o.label, 'label', 100);
  if (label.trim() === '') fail('label', 'must not be blank');
  let host: HostType | undefined;
  if (o.host !== undefined) {
    if (o.host !== '5250' && o.host !== '3270') fail('host', 'must be "5250" or "3270"');
    host = o.host;
  }
  let params: Record<string, MacroParam> | undefined;
  if (o.params !== undefined) {
    const p = obj(o.params, 'params');
    if (Object.keys(p).length > MAX_PARAMS) fail('params', `has more than ${MAX_PARAMS} parameters`);
    params = {};
    for (const [key, value] of Object.entries(p)) {
      const path = `params.${key.slice(0, 32)}`;
      if (!PARAM_NAME.test(key)) fail(path, 'must be a name of letters, digits and _');
      if ((RESERVED_PARAMS as readonly string[]).includes(key.toLowerCase())) fail(path, `"${key}" is reserved`);
      params[key] = param(value, path);
    }
  }
  const list = arr(o.steps, 'steps', MAX_STEPS);
  if (list.length === 0) fail('steps', 'needs at least one step');
  const steps = list.map((x, i) => step(x, `steps[${i}]`, host, params));
  if (o.menu !== undefined && typeof o.menu !== 'boolean') fail('menu', 'must be true or false');
  const timeout = o.timeout !== undefined ? int(o.timeout, 'timeout', 1, 600) : undefined;
  if (o.api !== undefined && typeof o.api !== 'boolean') fail('api', 'must be true or false');
  let output: Record<string, string> | undefined;
  if (o.output !== undefined) {
    const out = obj(o.output, 'output');
    if (Object.keys(out).length > MAX_OUTPUTS) fail('output', `has more than ${MAX_OUTPUTS} values`);
    output = {};
    for (const [key, value] of Object.entries(out)) {
      const path = `output.${key.slice(0, 32)}`;
      if (!PARAM_NAME.test(key)) fail(path, 'must be a name of letters, digits and _');
      const at = str(value, path, 7);
      if (!FIELD_ID.test(at)) fail(path, 'must be a position such as "12:40"');
      output[key] = at;
    }
    if (Object.keys(output).length === 0) output = undefined;
  }
  const end = o.end !== undefined ? macroEnd(o.end) : undefined;
  // In the order a person reads the file: what it is, its values, its steps.
  return {
    name, label,
    ...(host ? { host } : {}),
    ...(params ? { params } : {}),
    steps,
    ...(o.menu ? { menu: true } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
    ...(o.api ? { api: true } : {}),
    ...(output ? { output } : {}),
    ...(end ? { end } : {}),
  };
}

function macroEnd(v: unknown): MacroEnd {
  const o = obj(v, 'end');
  const out: MacroEnd = {};
  if (o.screen !== undefined) {
    out.screen = str(o.screen, 'end.screen', 32);
    if (!SCREEN_ID.test(out.screen)) fail('end.screen', 'must be a screen id (hex digits)');
  }
  if (o.text !== undefined) out.text = arr(o.text, 'end.text', 10).map((x, i) => textMatch(x, `end.text[${i}]`));
  if (o.title !== undefined) out.title = str(o.title, 'end.title', 132);
  if (o.expect !== undefined) out.expect = checks(o.expect, 'end.expect');
  if (!out.screen && !out.text?.length && !out.expect?.length) fail('end', 'needs a screen, text or checks');
  return out;
}

function checks(v: unknown, path: string): MacroCheck[] {
  return arr(v, path, MAX_CHECKS).map((x, i) => check(x, `${path}[${i}]`));
}

function check(v: unknown, path: string): MacroCheck {
  const o = obj(v, path);
  const out: MacroCheck = {};
  if (o.at !== undefined) {
    out.at = str(o.at, `${path}.at`, 7);
    if (!FIELD_ID.test(out.at)) fail(`${path}.at`, 'must be a position such as "6:22"');
  }
  if (o.message !== undefined) {
    if (o.message !== true) fail(`${path}.message`, 'must be true');
    out.message = true;
  }
  if ((out.at === undefined) === (out.message === undefined)) fail(path, 'needs either "at" (a position) or "message": true');
  const tests = (['equals', 'contains', 'matches'] as const).filter((k) => o[k] !== undefined);
  if (tests.length !== 1) fail(path, 'needs exactly one of "equals", "contains" or "matches"');
  const test = tests[0]!;
  out[test] = str(o[test], `${path}.${test}`, 3564);
  if (test === 'matches') {
    try { new RegExp(out.matches!); } catch { fail(`${path}.matches`, 'is not a valid regular expression'); }
  }
  if (o.not !== undefined) {
    if (typeof o.not !== 'boolean') fail(`${path}.not`, 'must be true or false');
    if (o.not) out.not = true;
  }
  if (o.label !== undefined) out.label = str(o.label, `${path}.label`, 60);
  return out;
}

function param(v: unknown, path: string): MacroParam {
  const o = obj(v, path);
  const out: MacroParam = {};
  if (o.label !== undefined) out.label = str(o.label, `${path}.label`, 60);
  if (o.required !== undefined) {
    if (typeof o.required !== 'boolean') fail(`${path}.required`, 'must be true or false');
    if (o.required) out.required = true;
  }
  if (o.pattern !== undefined) {
    out.pattern = str(o.pattern, `${path}.pattern`, 200);
    try { new RegExp(out.pattern); } catch { fail(`${path}.pattern`, 'is not a valid regular expression'); }
  }
  return out;
}

function step(v: unknown, path: string, host: HostType | undefined, params: Record<string, MacroParam> | undefined): MacroStep {
  const o = obj(v, path);
  const screen = str(o.screen, `${path}.screen`, 32);
  if (!SCREEN_ID.test(screen)) fail(`${path}.screen`, 'must be a screen id (hex digits)');
  const press = str(o.press, `${path}.press`, 20);
  if (!isAidName(press)) fail(`${path}.press`, 'must be a key such as Enter or F3');
  if (host && !hostHasAid(host, press)) fail(`${path}.press`, `is not a key on a ${host === '3270' ? 'mainframe' : 'IBM i'} terminal`);
  const text = o.text !== undefined ? arr(o.text, `${path}.text`, 10).map((x, i) => textMatch(x, `${path}.text[${i}]`)) : undefined;
  const title = o.title !== undefined ? str(o.title, `${path}.title`, 132) : undefined;
  let fields: Record<string, string> | undefined;
  if (o.fields !== undefined) {
    const f = obj(o.fields, `${path}.fields`);
    fields = {};
    for (const [id, value] of Object.entries(f)) {
      if (!FIELD_ID.test(id)) fail(`${path}.fields`, `"${id.slice(0, 20)}" is not a field id`);
      const typed = str(value, `${path}.fields["${id}"]`, 3564);
      for (const name of paramsIn(typed)) {
        if (name !== 'user' && !params?.[name]) fail(`${path}.fields["${id}"]`, `{${name}} is not one of the macro's parameters`);
      }
      fields[id] = typed;
    }
  }
  const cursor = o.cursor !== undefined ? target(o.cursor, `${path}.cursor`) : undefined;
  if (o.optional !== undefined && typeof o.optional !== 'boolean') fail(`${path}.optional`, 'must be true or false');
  const expect = o.expect !== undefined ? checks(o.expect, `${path}.expect`) : undefined;
  // In the order the step happens: which screen, what to type, which key.
  return {
    screen,
    ...(text ? { text } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(fields ? { fields } : {}),
    ...(cursor ? { cursor } : {}),
    press,
    ...(o.optional ? { optional: true } : {}),
    ...(expect?.length ? { expect } : {}),
  };
}

/**
 * The macro's parameter values from what it was given (a URL's query, a
 * button, the designer). Only declared parameters are taken; each must be
 * present if required and match its pattern. Throws DefinitionError with a
 * message for the user.
 */
export function macroValues(macro: Macro, given: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, p] of Object.entries(macro.params ?? {})) {
    const value = given[name]?.trim() ?? '';
    const called = p.label ?? name;
    if (value === '') {
      if (p.required) throw new DefinitionError(`${macro.label} needs ${called}.`);
      values[name] = '';
      continue;
    }
    if (value.length > MAX_PARAM_VALUE) throw new DefinitionError(`${called} is too long.`);
    if (p.pattern && !new RegExp(`^(?:${p.pattern})$`).test(value)) throw new DefinitionError(`“${value}” is not a valid ${called}.`);
    values[name] = value;
  }
  return values;
}

/**
 * The values a macro API caller gives, checked: only the macro's parameters,
 * each a string (a number is taken as its digits). Throws DefinitionError.
 */
export function apiValues(macro: Macro, body: unknown): Record<string, string> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new DefinitionError('The body must be a JSON object of the macro\'s values.');
  const given: Record<string, string> = {};
  for (const [name, value] of Object.entries(body)) {
    if (!macro.params?.[name]) {
      const known = Object.keys(macro.params ?? {});
      throw new DefinitionError(`“${name.slice(0, 32)}” is not one of the macro's values${known.length ? ` (${known.join(', ')})` : ': it takes none'}.`);
    }
    if (typeof value === 'number' && Number.isFinite(value)) given[name] = String(value);
    else if (typeof value === 'string') given[name] = value;
    else throw new DefinitionError(`${macro.params[name]!.label ?? name} must be text or a number.`);
  }
  return macroValues(macro, given);
}

/** A field value with its {parameters} filled in. */
export function fillValue(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(PLACEHOLDER, (m, name: string) => values[name] ?? m);
}

/** Whether a screen is the one a step expects. */
export function stepMatches(s: MacroStep, snap: ScreenSnapshot, id = screenId(snap)): boolean {
  return s.screen === id && (s.text ?? []).every((t) => textMatches(snap, t));
}

/** The screens a macro uses, for the screen inventory. */
export function macroScreens(macro: Macro): string[] {
  return [...new Set([...macro.steps.map((s) => s.screen), ...(macro.end?.screen ? [macro.end.screen] : [])])];
}

/** A field's value, or the text at a position up to the next wide gap. Non-display fields (passwords) read as blank. */
export function valueAt(snap: ScreenSnapshot, at: string): string {
  const field = snap.fields.find((f) => f.id === at);
  if (field) return field.attr.nonDisplay ? '' : field.value.trim();
  const [row, col] = at.split(':').map(Number) as [number, number];
  const rest = snap.lines[row - 1]?.slice(col - 1) ?? '';
  return rest.trimStart().split(/\s{2,}/)[0]!.trim();
}

/** The host's message on a screen: its message line and any error. */
export type MessageReader = (snap: ScreenSnapshot) => string;

const errorOnly: MessageReader = (snap) => snap.error?.trim() ?? '';

/** Makes one check on a screen. */
export function runCheck(c: MacroCheck, snap: ScreenSnapshot, message: MessageReader = errorOnly, step?: number): CheckResult {
  const actual = c.message ? message(snap).trim() : valueAt(snap, c.at!);
  const what = c.label ?? (c.message ? 'The message' : `The value at ${c.at}`);
  let ok: boolean;
  let test: string;
  if (c.equals !== undefined) {
    const want = c.equals.trim();
    ok = actual === want;
    test = want === '' ? (c.not ? 'is not blank' : 'is blank') : `${c.not ? 'doesn\'t equal' : 'equals'} “${want}”`;
  } else if (c.contains !== undefined) {
    ok = actual.includes(c.contains);
    test = `${c.not ? 'doesn\'t contain' : 'contains'} “${c.contains}”`;
  } else {
    ok = new RegExp(`^(?:${c.matches})$`).test(actual);
    test = `${c.not ? 'doesn\'t match' : 'matches'} ${c.matches}`;
  }
  return { ...(step ? { step } : {}), check: `${what} ${test}`, passed: c.not ? !ok : ok, actual };
}

/** Why a check failed, for an error message: Status equals “DLV”, but it is “OPN”. */
export function failureText(r: CheckResult): string {
  return `${r.check}, but it is ${r.actual === '' ? 'blank' : `“${r.actual}”`}.`;
}

/** Where a run starts: a deep link's new session, or the screen the user is on (a button, Go to, a test). */
export type MacroStart = 'link' | 'here';

export type MacroResult =
  /** Type these values and press the key. `step` counts from 1. */
  | { send: { aid: AidName; fields: Record<string, string>; cursor?: Target }; step: number }
  /** Nothing to do yet: wait for the next screen. */
  | { wait: true }
  /**
   * Finished: left on the screen it reached; `error` says why it stopped early
   * or failed a check. `checks` has every check made, when the macro has any.
   */
  | { done: true; error?: string; step?: number; checks?: CheckResult[] };

export type MacroDone = Extract<MacroResult, { done: true }>;

/** Says what is wrong with typing `value` into a field (too long, letters in a number), or undefined. */
export type FieldCheck = (field: FieldSnapshot, value: string) => string | undefined;

/**
 * One run of a macro. Give it every screen the host sends; it answers with
 * the key to press, wait, or done. Steps are matched by screen: optional ones
 * that don't appear are skipped; any other screen, or a host error, stops the
 * run there and leaves the user on that screen.
 */
export class MacroRun {
  readonly macro: Macro;
  private readonly values: Record<string, string>;
  private readonly start: MacroStart;
  private readonly check: FieldCheck | undefined;
  private readonly message: MessageReader;
  private readonly made: CheckResult[] = [];
  /** The next step expected, or -1 before the first one is found. */
  private next = -1;
  private finished = false;

  constructor(
    macro: Macro, values: Record<string, string>,
    opts: { start: MacroStart; user?: string | undefined; check?: FieldCheck; message?: MessageReader },
  ) {
    this.macro = macro;
    this.values = { ...values, user: opts.user ?? '' };
    this.start = opts.start;
    this.check = opts.check;
    this.message = opts.message ?? errorOnly;
  }

  /** The macro checks what screens show (`expect` on a step, or `end`). */
  get checks(): boolean {
    return Boolean(this.macro.end) || this.macro.steps.some((s) => s.expect?.length);
  }

  /** The checks made so far, when the macro has any. */
  get results(): CheckResult[] | undefined {
    return this.checks ? [...this.made] : undefined;
  }

  /** The step being waited for (from 1), or 0 before the run has found where to start. */
  get step(): number {
    return this.next + 1;
  }

  get total(): number {
    return this.macro.steps.length;
  }

  /** The time to wait for the next screen, in milliseconds; undefined while waiting to start from a deep link. */
  get timeoutMs(): number | undefined {
    if (this.next < 0 && this.start === 'link') return undefined;
    return (this.macro.timeout ?? DEFAULT_MACRO_TIMEOUT) * 1000;
  }

  onScreen(snap: ScreenSnapshot): MacroResult {
    if (this.finished) return { done: true };
    const steps = this.macro.steps;
    // After a key: the host's answer to it. An error keeps the keyboard locked until Reset.
    // Past the last step, an `end` that checks the message expects it.
    if (this.next >= steps.length && snap.error && this.macro.end?.expect?.some((c) => c.message)) return this.end(snap);
    if (this.next > 0 && snap.error) return this.stop(`Step ${this.next}: ${snap.error.trim()}`, this.next);
    if (snap.keyboardLocked) return { wait: true };
    if (this.macro.host && snap.host !== this.macro.host) return this.stop('It is for another kind of host.');
    const id = screenId(snap);
    if (this.next >= steps.length) return this.end(snap, id);

    if (this.next < 0) {
      const first = steps.findIndex((s) => stepMatches(s, snap, id));
      if (first < 0) {
        // A deep link waits for its first screen (the user may be signing on).
        return this.start === 'link' ? { wait: true } : this.stop('It doesn\'t start from this screen.');
      }
      return this.perform(first, snap);
    }
    let k = this.next;
    while (k < steps.length && !stepMatches(steps[k]!, snap, id) && steps[k]!.optional) k++;
    if (k < steps.length && stepMatches(steps[k]!, snap, id)) return this.perform(k, snap);
    const expected = steps[this.next]!;
    return this.stop(`Step ${this.next + 1} expected ${expected.title ? `the “${expected.title}” screen` : 'a different screen'}.`, this.next + 1);
  }

  /** The host did not answer in time. */
  timedOut(): MacroDone {
    return this.stop(`Step ${this.step}: the screen did not appear in time.`, this.step);
  }

  cancel(): MacroDone {
    return this.stop('Stopped.');
  }

  private perform(k: number, snap: ScreenSnapshot): MacroResult {
    const s = this.macro.steps[k]!;
    const failed = this.expect(s.expect, snap, k + 1);
    if (failed) return this.stop(`Step ${k + 1}: ${failed}`, k + 1);
    const fields: Record<string, string> = {};
    for (const [id, template] of Object.entries(s.fields ?? {})) {
      const field = snap.fields.find((f) => f.id === id && !f.bypass);
      if (!field) return this.stop(`Step ${k + 1}: the field at ${id} is not on the screen.`, k + 1);
      const value = fillValue(template, this.values);
      const problem = value.length > field.length ? `“${value}” is too long for the field at ${id}.` : this.check?.(field, value);
      if (problem) return this.stop(`Step ${k + 1}: ${problem}`, k + 1);
      fields[id] = value;
    }
    this.next = k + 1;
    return { send: { aid: s.press, fields, ...(s.cursor ? { cursor: s.cursor } : {}) }, step: k + 1 };
  }

  /** The screen the last step's key led to: the macro's `end`, if it has one. */
  private end(snap: ScreenSnapshot, id = screenId(snap)): MacroDone {
    const end = this.macro.end;
    if (!end) return this.stop();
    if (end.screen || end.text?.length) {
      const expected = end.title ? `“${end.title}”` : 'the screen it should';
      const on = (end.screen === undefined || end.screen === id) && (end.text ?? []).every((t) => textMatches(snap, t));
      this.made.push({ check: `It ends on ${expected}`, passed: on, actual: id });
      if (!on) return this.stop(`It ended on another screen than ${expected}.`);
    }
    const failed = this.expect(end.expect, snap);
    return this.stop(failed ? `At the end: ${failed}` : undefined);
  }

  /** Makes every check on a screen; the first failure in words (with how many others failed), or undefined. */
  private expect(list: readonly MacroCheck[] | undefined, snap: ScreenSnapshot, step?: number): string | undefined {
    if (!list?.length) return undefined;
    const now = list.map((c) => runCheck(c, snap, this.message, step));
    this.made.push(...now);
    const failed = now.filter((r) => !r.passed);
    if (failed.length === 0) return undefined;
    const more = failed.length - 1;
    return failureText(failed[0]!) + (more > 0 ? ` ${more} other ${more === 1 ? 'check' : 'checks'} failed too.` : '');
  }

  private stop(error?: string, step?: number): MacroDone {
    this.finished = true;
    return {
      done: true, ...(error ? { error } : {}), ...(step ? { step } : {}),
      ...(this.checks ? { checks: [...this.made] } : {}),
    };
  }
}
