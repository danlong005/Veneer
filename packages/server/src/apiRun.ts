// One macro API run (macroApi.ts): a host session of its own, signed on as
// the client's service profile, driven by the same MacroRun the browser
// uses, so a run makes the same screen-by-screen checks a user's would. The
// screen it ends on is read as the browser reads it (@veneer/view): its
// fields, the values the macro names, its messages and its list, every
// page. Then the session closes, which ends the IBM i job.

import { DEFAULT_MACRO_TIMEOUT, MacroRun, matchScreen, screenId, type Macro, type ScreenDefinition } from '@veneer/screens';
import { DeviceNameInUseError, type ScreenSnapshot, type SignOnResult, type TerminalSession } from '@veneer/terminal';
import { ListExporter, checkFields, customize, listOf, transform, typingProblem, type ScreenView, type Sheet, type Step } from '@veneer/view';
import { createHostSession, hostAid, type AutoSignOn, type HostSettings } from './host.ts';
import { log } from './log.ts';
import type { HostLease } from './sessions.ts';
import { signOnError } from './sessions.ts';
import { signOnUserField } from './signon.ts';

/** Host records often arrive in bursts; wait this long for the screen to settle. */
const SETTLE_MS = 10;
/** A list longer than this many pages is returned as far as it got, marked incomplete. */
export const API_MAX_PAGES = 100;

export interface ScreenResult {
  screen: { id: string; title: string | null; definition: string | null };
  /** The values the macro's `output` names. */
  values: Record<string, string>;
  /** Every field on the screen by id (row:col), but non-display ones (passwords). */
  fields: Record<string, string>;
  /** The screen's list, every page, rows by column heading; null when it has none. */
  list: ListResult | null;
  /** The host's messages: the message line and any error. */
  messages: string[];
  /** The screen's text, row by row. */
  lines: string[];
}

export interface ListResult {
  columns: string[];
  rows: Array<Record<string, string>>;
  /** False when it stopped at the page limit. */
  complete: boolean;
}

export type RunResult =
  | { outcome: 'done'; result: ScreenResult }
  /** It stopped on a screen it didn't expect, a host error or a value the field won't take; `result` is that screen. */
  | { outcome: 'stopped' | 'timeout'; error: string; step?: number; result: ScreenResult }
  /** It never ran: the service profile didn't sign on. `refused` says signing on again would fail the same way. */
  | { outcome: 'signon'; error: string; refused: boolean }
  /** It never finished: the connection failed or closed. */
  | { outcome: 'host'; error: string };

export interface RunInput {
  host: HostSettings;
  lease: HostLease;
  signOn: AutoSignOn;
  macro: Macro;
  values: Record<string, string>;
  definitions: () => readonly ScreenDefinition[];
  /** Log each host record (VENEER_TRACE). */
  trace?: ((dir: 'in' | 'out', rec: Buffer) => void) | undefined;
}

export function runMacro(input: RunInput): Promise<RunResult> {
  return new Promise((resolve) => new ApiRun(input, resolve).start());
}

class ApiRun {
  private readonly input: RunInput;
  private readonly resolve: (r: RunResult) => void;
  private readonly host: TerminalSession;
  private readonly run: MacroRun;
  private readonly stepMs: number;
  private phase: 'signon' | 'macro' | 'list' = 'signon';
  private finished = false;
  private timer: NodeJS.Timeout | undefined;
  private settle: NodeJS.Timeout | undefined;
  /** The screen the macro ended on, while its list is read. */
  private ended: ScreenResult | undefined;
  private reader: ListExporter | undefined;

  constructor(input: RunInput, resolve: (r: RunResult) => void) {
    this.input = input;
    this.resolve = resolve;
    this.stepMs = (input.macro.timeout ?? DEFAULT_MACRO_TIMEOUT) * 1000;
    this.run = new MacroRun(input.macro, input.values, { start: 'link', user: input.signOn.user, check: typingProblem });
    let retries = 0;
    const { lease } = input;
    this.host = createHostSession(input.host, {
      ...(lease.deviceName ? { deviceName: lease.deviceName, onDeviceNameInUse: (name: string) => lease.nextDeviceName(name, ++retries) } : {}),
      autoSignOn: input.signOn,
      ...(input.trace ? { trace: input.trace } : {}),
    });
  }

  start(): void {
    const { host } = this;
    host.on('signOn', (r) => this.onSignOn(r));
    host.on('screen', () => {
      if (this.settle || this.finished) return;
      this.settle = setTimeout(() => { this.settle = undefined; this.onScreen(host.snapshot()); }, SETTLE_MS);
    });
    host.on('warning', (message) => log.warn('protocol warning', { macro: this.input.macro.name, message }));
    host.on('close', (err) => {
      if (err instanceof DeviceNameInUseError) return this.finish({ outcome: 'host', error: 'Every device name tried is in use on the IBM i; try again later.' });
      this.finish({ outcome: 'host', error: `The IBM i closed the connection${err ? `: ${err.message}` : ''}.` });
    });
    this.wait(() => this.finish({ outcome: 'host', error: 'The IBM i did not answer in time.' }));
    host.connect().catch((err: Error) => this.finish({ outcome: 'host', error: `Could not connect to the IBM i: ${err.message}` }));
  }

  private onSignOn(r: SignOnResult): void {
    if (this.phase !== 'signon') return;
    const user = this.input.signOn.user;
    switch (r.outcome) {
      case 'signed-on':
        this.signedOn();
        return;
      case 'rejected':
        return this.finish({ outcome: 'signon', error: `Signing on as ${user} failed: ${signOnError(r.code)}`, refused: refusedFor(r.code) });
      case 'expired':
        return this.finish({ outcome: 'signon', error: `The password of ${user} has expired. Change it on the IBM i and in Veneer's settings.`, refused: true });
      case 'not-allowed':
        return this.finish({
          outcome: 'signon', refused: true,
          error: 'The IBM i doesn\'t allow automatic sign-on, which the macro API needs: set the QRMTSIGN system value to *VERIFY or *SAMEPRF.',
        });
    }
  }

  /** Signed on: the first step's screen has the step time to appear (past Display Program Messages and the like). */
  private signedOn(): void {
    this.phase = 'macro';
    this.wait(() => this.notStarted());
  }

  private onScreen(snap: ScreenSnapshot): void {
    if (this.finished) return;
    if (this.phase === 'signon') {
      if (snap.keyboardLocked) return;
      // A host that sent no Startup Response Record: its first screen says how signing on went.
      if (signOnUserField(snap)) {
        return this.finish({ outcome: 'signon', error: `The IBM i didn't sign ${this.input.signOn.user} on, and didn't say why.`, refused: true });
      }
      this.signedOn();
    }
    if (snap.keyboardLocked && !snap.error) return;
    if (this.phase === 'macro') this.macroScreen(snap);
    else this.listScreen(snap);
  }

  private macroScreen(snap: ScreenSnapshot): void {
    const r = this.run.onScreen(snap);
    // Waiting for the first step's screen: the timer started at sign-on keeps running.
    if ('wait' in r) return;
    if ('send' in r) {
      const { aid, fields, cursor } = r.send;
      // Mandatory entry and fill, as the browser checks for a user pressing Enter.
      const problem = aid === 'Enter' ? checkFields(snap.fields, fields) : null;
      if (problem) return this.stop(`Step ${r.step}: ${problem.message}`, r.step, snap);
      this.press(snap, aid, fields, cursor);
      this.wait(() => {
        const t = this.run.timedOut();
        this.finish({ outcome: 'timeout', error: t.error!, ...(t.step ? { step: t.step } : {}), result: this.read(this.host.snapshot()) });
      });
      return;
    }
    if (r.error) return this.stop(r.error, r.step, snap);
    // Done: read the screen, then its list, page by page.
    const view = this.view(snap);
    this.ended = this.read(snap, view);
    const table = listOf(view);
    if (!table) return this.finish({ outcome: 'done', result: this.ended });
    this.phase = 'list';
    this.reader = new ListExporter(table, screenId(snap), API_MAX_PAGES, { goBack: false });
    this.listStep(this.reader.start(), snap);
  }

  /** The first step's screen never came after signing on. */
  private notStarted(): void {
    const snap = this.host.snapshot();
    const first = this.input.macro.steps[0]!;
    const shown = this.view(snap);
    const title = shown.window?.title ?? shown.title;
    this.stop(
      `After signing on, the IBM i showed ${title ? `“${title}”` : 'a screen'} instead of ${first.title ? `“${first.title}”` : 'the first step\'s screen'}.`,
      1, snap,
    );
  }

  private listScreen(snap: ScreenSnapshot): void {
    // An error is the host refusing a page key at the top or bottom of the list.
    this.listStep(this.reader!.onScreen(this.view(snap), screenId(snap), Boolean(snap.error)), snap);
  }

  private listStep(s: Step, snap: ScreenSnapshot): void {
    if ('send' in s) {
      this.press(snap, s.send, {});
      this.wait(() => this.finish({ outcome: 'timeout', error: 'Reading the list: the next page did not appear in time.', result: this.ended! }));
      return;
    }
    if (s.error || !s.sheet) return this.finish({ outcome: 'stopped', error: `Reading the list: ${s.error ?? 'it stopped.'}`, result: this.ended! });
    this.finish({ outcome: 'done', result: { ...this.ended!, list: listResult(s.sheet, s.complete !== false) } });
  }

  private press(snap: ScreenSnapshot, aid: Parameters<typeof hostAid>[1], fields: Record<string, string>, cursor?: { row: number; col: number }): void {
    // As on a 5250, an error holds the keyboard until Reset.
    if (snap.error) this.host.reset();
    this.host.submit({ aid: hostAid(this.input.host, aid), fields, cursor: cursor ?? snap.cursor });
  }

  private stop(error: string, step: number | undefined, snap: ScreenSnapshot): void {
    this.finish({ outcome: 'stopped', error, ...(step ? { step } : {}), result: this.read(snap) });
  }

  private view(snap: ScreenSnapshot): ScreenView {
    return customize(transform(snap), matchScreen(snap, this.input.definitions()));
  }

  private read(snap: ScreenSnapshot, view = this.view(snap)): ScreenResult {
    return readScreen(snap, view, this.input.macro.output);
  }

  /** (Re)start the timer for the screen being waited for. */
  private wait(onTimeout: () => void): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (!this.finished) onTimeout(); }, this.stepMs);
  }

  private finish(r: RunResult): void {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    clearTimeout(this.settle);
    this.host.close();
    this.input.lease.release();
    this.resolve(r);
  }
}

/** Sign-on codes that mean the profile or its password is wrong: trying again would fail too, or disable the profile. */
function refusedFor(code: string | undefined): boolean {
  return ['0002', '0003', '0004', '0006', '0008', '8917'].includes(code ?? '');
}

/** What the caller gets from a screen. */
export function readScreen(snap: ScreenSnapshot, view: ScreenView, output: Readonly<Record<string, string>> = {}): ScreenResult {
  const fields: Record<string, string> = {};
  for (const f of snap.fields) if (!f.attr.nonDisplay) fields[f.id] = f.value.trimEnd();
  const values: Record<string, string> = {};
  for (const [name, at] of Object.entries(output)) values[name] = valueAt(snap, at);
  const messages: string[] = [];
  const message = view.window?.message ?? view.message;
  if (message?.text.trim()) messages.push(message.text.trim());
  if (snap.error?.trim() && !messages.includes(snap.error.trim())) messages.push(snap.error.trim());
  return {
    screen: { id: screenId(snap), title: view.window?.title ?? view.title ?? null, definition: view.definition?.id ?? null },
    values, fields, list: null, messages, lines: snap.lines.map((l) => l.trimEnd()),
  };
}

/** A field's value, or the text at a position up to the next wide gap. */
function valueAt(snap: ScreenSnapshot, at: string): string {
  const field = snap.fields.find((f) => f.id === at);
  if (field) return field.attr.nonDisplay ? '' : field.value.trim();
  const [row, col] = at.split(':').map(Number) as [number, number];
  const rest = snap.lines[row - 1]?.slice(col - 1) ?? '';
  return rest.trimStart().split(/\s{2,}/)[0]!.trim();
}

/** Rows by column heading: a blank heading is "column3", a repeated one "Date 2". */
export function listResult(sheet: Sheet, complete: boolean): ListResult {
  const seen = new Map<string, number>();
  const columns = sheet.header.map((h, k) => {
    const base = h.replace(/\s+/g, ' ').trim() || `column${k + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} ${n}`;
  });
  const rows = sheet.rows.map((r) => Object.fromEntries(columns.map((c, k) => [c, r[k] ?? ''])));
  return { columns, rows, complete };
}
