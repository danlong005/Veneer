import type { AidName, ScreenSnapshot } from '@veneer/terminal';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DefinitionError, MacroRun, fillText, fillUrl, macroValues, matchScreen, screenId, themeBase,
  type ButtonAction, type Macro, type MacroAction, type MacroResult, type MacroStart, type MacroStep, type ScreenDefinition, type Target,
} from '@veneer/screens';
import { download, fileBase } from '../export/download.ts';
import { ListExporter, MAX_PAGES, PageReader, RowSeeker, listOf, listSource, regionPage, regionSource, tablePage, type Progress, type ReadStep, type SeekStep, type Step, type TablePage, type TextPage } from '@veneer/view';
import { listData } from '../custom/components.ts';
import type { ListData, ListRecord, PagesData, ReadListOptions, ReadPagesOptions } from '../custom/runtime.ts';
import { HelpReader, type HelpPage, type HelpStep } from '../help/help.ts';
import { exportColumns, toCsv, toXlsx } from '@veneer/view';
import { connectHost, notifyScreen, runScript, runSiteScript, screenInfo, setScreen } from '../custom/runtime.ts';
import { DesignPanel } from '../designer/DesignPanel.tsx';
import { MacrosPanel } from '../macros/MacrosPanel.tsx';
import { linkedMacro, macroFieldCheck, recordStep } from '../macros/edit.ts';
import { record, redo, startHistory, undo, type History } from '../designer/history.ts';
import { cardsOf, componentAt, htmlAt, imageAt, labelAt, moveOf, newDefinition, resolveSelection, setCard, setComponent, setHtml, setMove, setPlaced, toggleTextAreaField } from '../designer/edit.ts';
import { customize } from '@veneer/view';
import { EMPTY_CONSOLE, nextConsole } from '@veneer/view';
import { transform } from '@veneer/view';
import type { Action, FunctionKey, ScreenView, TableItem } from '@veneer/view';
import { ClassicScreen } from './ClassicScreen.tsx';
import { DropMenu, ExportMenu, type ExportFormat } from './ExportMenu.tsx';
import { HelpPopover } from './HelpPopover.tsx';
import type { FieldBinding } from './fieldInput.tsx';
import { KEYS_3270, isLocalKey, keyAction, keyHint, typedKey, type KeyContext, type LocalKey } from './keys.ts';
import { DEFAULT_BRAND, useBrand } from './brand.ts';
import { checkFields, erasedInput, erasedToEnd } from './fieldRules.ts';
import { applyTheme, useThemeLogo } from './themes.ts';
import { ModernScreen, revealField, type BoxKind } from './ModernScreen.tsx';
import { indexAt, lineAt } from './textArea.ts';
import { MAX_TYPEAHEAD, caretAtCursor, caretPosition, replay, type Caret, type ReplayResult, type TypedKey } from './typeahead.ts';
import { useScreens } from './useScreens.ts';
import { sysreqField } from './sysreq.ts';
import { NEW_SESSION, useSession } from './useSession.ts';
import { SignOnPage } from './SignOnPage.tsx';

type Mode = 'modern' | 'classic';

/** A step from any paging job: a key to send, or done (with what it found). */
type JobStep = Step | ReadStep<TablePage> | ReadStep<TextPage> | SeekStep;

/** Something paging through the host for the user (see @veneer/view, export/exporter.ts). */
interface ListJob {
  /** The progress dialog's heading. */
  title: string;
  runner: { onScreen(view: ScreenView, screenId: string, refused?: boolean): JobStep; cancel(): void; readonly progress: Progress };
  /** Show the progress dialog only if it takes longer than QUIET_MS. */
  quiet?: boolean;
  /** Called with the last step, on the screen it ended on. */
  done(step: JobStep, from: ScreenSnapshot): void;
}

/** How long a component's read runs before its progress shows, in ms. */
const QUIET_MS = 400;
const MODE_KEY = 'veneer.mode';

function loadMode(): Mode {
  try { return localStorage.getItem(MODE_KEY) === 'classic' ? 'classic' : 'modern'; } catch { return 'modern'; }
}

export function App() {
  const session = useSession();
  const brand = useBrand();
  const snap = session.screen?.snap ?? null;
  const seq = session.screen?.seq ?? 0;
  const [mode, setMode] = useState<Mode>(loadMode);
  const screens = useScreens(session.screensVersion);
  // The site's theme; the designer previews a draft while its Themes tab is open.
  useEffect(() => { applyTheme(screens.theme); }, [screens.theme]);
  const themeLogo = useThemeLogo();
  // The tab icon follows the logo: the theme's, else the brand's.
  useEffect(() => {
    if (!brand) return;
    const icon = themeLogo ?? (brand.logo !== DEFAULT_BRAND.logo ? brand.logo : null);
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;
    link.dataset.veneerIcon ??= link.getAttribute('href') ?? '';
    link.setAttribute('href', icon ?? link.dataset.veneerIcon);
  }, [themeLogo, brand]);
  const definition = useMemo(() => (snap ? matchScreen(snap, screens.screens) : undefined), [snap, screens.screens]);
  // The kind of host: from the screen, or before the first one from the server.
  const hostType = snap?.host ?? screens.host?.type ?? '5250';
  const is3270 = hostType === '3270';
  // Page Up and Page Down: a 5250's own keys; on a 3270 what the server maps them to, if anything.
  const pageKeys = is3270 ? screens.host?.pageKeys ?? null : { up: 'PageUp' as const, down: 'PageDown' as const };
  const keyContext: KeyContext = { host: hostType, paging: pageKeys !== null };
  const keyContextNow = useRef(keyContext);
  keyContextNow.current = keyContext;
  // A 3270 types over what is there, as a real one does: host screens are full of
  // pre-filled fields to type over. Insert switches to inserting until pressed again.
  const [inserting, setInserting] = useState(false);
  const overtype = is3270 && !inserting;

  // Designer: a draft definition previewed live in place of the matched one,
  // with undo history. resetDraft starts over, without a step to undo.
  const [history, setHistory] = useState<History<ScreenDefinition | null>>(() => startHistory(null));
  const draft = history.present;
  const setDraft = useCallback((def: ScreenDefinition) => setHistory((h) => record(h, def, Date.now())), []);
  const resetDraft = (def: ScreenDefinition | null) => setHistory(startHistory(def));
  const [draftExisting, setDraftExisting] = useState(false);
  const [selectedAt, setSelectedAt] = useState<Target | null>(null);
  // The text area (its first field) whose lines a click on a field adds or takes out.
  const [joining, setJoining] = useState<string | null>(null);
  const designing = draft !== null;
  // Preview: the screen as users see it, without design ghosts or outlines,
  // and look-only so a click cannot send anything to the host.
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => { if (!designing) setPreviewing(false); }, [designing]);
  const designView = designing && !previewing;
  const designingNow = useRef(false);
  designingNow.current = designing;

  const baseView = useMemo(() => (snap ? transform(snap) : null), [snap]);
  // TSO's line mode: earlier pages of output, to scroll back to (nextConsole gives the same log for the same screen).
  const consoleLog = useRef(EMPTY_CONSOLE);
  const consoleHistory = useMemo(() => {
    if (snap) consoleLog.current = nextConsole(consoleLog.current, snap);
    return consoleLog.current.history;
  }, [snap]);
  const view = useMemo(
    () => (baseView ? customize(baseView, designing ? draft : definition, { design: designView, themeBase: screens.theme ? themeBase(screens.theme.name) : undefined }) : null),
    [baseView, definition, draft, designing, designView, screens.theme],
  );
  const selection = useMemo(
    () => (designing && view && snap && selectedAt ? resolveSelection(view, snap, selectedAt) : null),
    [designing, view, snap, selectedAt],
  );
  const savedDraft = draft ? screens.screens.find((d) => d.id === draft.id) : undefined;
  useEffect(() => { setJoining(null); }, [selectedAt, designing]);
  /** A click on the screen in the designer: picks a text area's fields, or selects. */
  const selectOnScreen = (at: Target) => {
    if (joining && draft && view && snap) {
      const picked = resolveSelection(view, snap, at);
      if (picked?.kind === 'field' && picked.field.id !== joining) {
        setDraft(toggleTextAreaField(draft, joining, picked.field.id));
        return;
      }
    }
    setSelectedAt(at);
  };

  const startDesign = () => {
    if (!snap || !baseView) return;
    resetDraft(definition ? structuredClone(definition) : newDefinition(snap, baseView));
    setDraftExisting(Boolean(definition));
    setSelectedAt(null);
    setMode('modern');
  };
  const confirmDiscard = () => {
    const unsaved = draft && (savedDraft ? JSON.stringify(savedDraft) !== JSON.stringify(draft) : draft.changes.length > 0 || Boolean(draft.title));
    return !unsaved || window.confirm('Discard unsaved design changes?');
  };
  const stopDesign = () => {
    if (!confirmDiscard()) return;
    resetDraft(null);
    setSelectedAt(null);
  };
  // Dragging and arrow keys in the designer. HTML boxes change their own
  // position; other items get a `move` change.
  const moveItem = (at: Target, by: { rows: number; cols: number }) => {
    if (!draft || !snap) return;
    const clamp = (t: Target): Target => ({
      row: Math.min(snap.rows, Math.max(1, t.row + by.rows)),
      col: Math.min(snap.cols, Math.max(1, t.col + by.cols)),
    });
    const html = htmlAt(draft, at);
    if (html) {
      const { op: _op, ...rest } = html;
      const to = clamp(at);
      setDraft(setHtml(draft, at, { ...rest, at: to }));
      setSelectedAt(to);
      return;
    }
    const component = componentAt(draft, at);
    if (component) {
      const { op: _op, ...rest } = component;
      const to = clamp(at);
      setDraft(setComponent(draft, at, { ...rest, at: to }));
      setSelectedAt(to);
      return;
    }
    const placed = labelAt(draft, at) ?? imageAt(draft, at);
    if (placed) {
      const to = clamp(at);
      setDraft(setPlaced(draft, at, { ...placed, at: to }));
      setSelectedAt(to);
      return;
    }
    setDraft(setMove(draft, at, clamp(moveOf(draft, at) ?? at)));
  };
  const resizeBox = (at: Target, size: { width: number; height: number }, kind: BoxKind) => {
    if (kind === 'card') {
      const card = draft && snap ? cardsOf(draft).find((c) => c.from.row === at.row && c.from.col === at.col) : undefined;
      if (!draft || !snap || !card) return;
      setDraft(setCard(draft, at, {
        ...card, to: { row: Math.min(snap.rows, at.row + size.height - 1), col: Math.min(snap.cols, at.col + size.width - 1) },
      }));
      return;
    }
    if (kind === 'component') {
      const c = draft && snap ? componentAt(draft, at) : undefined;
      if (!draft || !snap || !c) return;
      const { op: _op, ...rest } = c;
      setDraft(setComponent(draft, at, {
        ...rest, width: Math.min(snap.cols, Math.max(1, size.width)), height: Math.min(snap.rows, Math.max(1, size.height)),
      }));
      return;
    }
    if (kind === 'image') {
      const image = draft && snap ? imageAt(draft, at) : undefined;
      if (!draft || !snap || !image) return;
      setDraft(setPlaced(draft, at, {
        ...image, width: Math.min(snap.cols, Math.max(1, size.width)), height: Math.min(snap.rows, Math.max(1, size.height)),
      }));
      return;
    }
    const html = draft && snap ? htmlAt(draft, at) : undefined;
    if (!draft || !snap || !html) return;
    const { op: _op, ...rest } = html;
    setDraft(setHtml(draft, at, {
      ...rest, width: Math.min(snap.cols, Math.max(1, size.width)), height: Math.min(snap.rows, Math.max(1, size.height)),
    }));
  };
  const pickDefinition = (def: ScreenDefinition | null) => {
    if (!snap || !baseView || !confirmDiscard()) return;
    resetDraft(def ? structuredClone(def) : newDefinition(snap, baseView));
    setDraftExisting(def !== null);
  };

  // Edits made on the current screen, by field id.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const clickedCursor = useRef<{ row: number; col: number } | null>(null);
  // Seq of the screen an AID was sent from; cleared when a newer screen unlocks.
  const [awaitingSeq, setAwaitingSeq] = useState<number | null>(null);
  // Keys typed while waiting, replayed into the next screen (type-ahead).
  const queue = useRef<TypedKey[]>([]);
  const [queued, setQueued] = useState(0);
  // Where to put focus after the next render.
  const focusTarget = useRef<Caret | null>(null);

  // Problems found before sending (mandatory fields), shown like server errors.
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(null);
  useEffect(() => { if (session.error) setNotice(session.error); }, [session.error]);

  const connected = session.state === 'connected' && snap !== null;
  const canSubmit = Boolean(connected && awaitingSeq === null && (!snap!.keyboardLocked || snap!.error));
  const typingAhead = connected && !canSubmit && !snap!.error;
  // Set synchronously when an AID is sent, so keys typed before React re-renders
  // are queued rather than landing in the old screen's fields.
  const awaitingNow = useRef(false);
  const typingAheadNow = useRef(false);
  typingAheadNow.current = typingAhead;

  const sendAid = useCallback((aid: AidName, values: Record<string, string>, cursor: { row: number; col: number }) => {
    if (!snap) return;
    const fields: Record<string, string> = {};
    for (const [id, value] of Object.entries(values)) {
      const f = snap.fields.find((x) => x.id === id);
      if (f && (value !== f.value || f.attr.nonDisplay)) fields[id] = value;
    }
    // Recording a macro: the user's own keys, not paging for an export, help or a macro.
    if (recording.current && !exporting.current && !helping.current && !macroJob.current) {
      recording.current = [...recording.current, recordStep(snap, view?.title, aid, fields, cursor)];
      setRecorded(recording.current);
    }
    awaitingNow.current = true;
    setAwaitingSeq(seq);
    transferring.current = null;
    session.send({ type: 'submit', aid, fields, cursor });
  }, [snap, seq, session, view]);

  const submit = useCallback((aid: AidName, extra: Record<string, string> = {}, cursor?: { row: number; col: number }) => {
    if (!snap || !canSubmit || helping.current) return;
    const values = { ...edits, ...extra };
    if (aid === 'Enter') {
      const problem = checkFields(snap.fields, values);
      if (problem) {
        setNotice({ id: Date.now(), message: problem.message });
        focusTarget.current = endOf(snap, values, problem.id);
        setEdits(values);
        return;
      }
    }
    sendAid(aid, values, cursor ?? currentCursor(snap, clickedCursor.current));
  }, [snap, canSubmit, edits, sendAid]);

  const binding: FieldBinding = useMemo(() => ({
    value: (f) => edits[f.id] ?? f.value,
    onChange: (f, value) => setEdits((e) => ({ ...e, [f.id]: value })),
    onAutoEnter: (f, value) => submit('Enter', { [f.id]: value }),
    onKey: (f, aid) => submit(aid, {}, { row: f.row, col: f.col }),
    overtype,
  }), [edits, submit, overtype]);

  // 3270 editing keys, done in the browser: Erase EOF, Erase Input, Insert.
  const localKey = useCallback((key: LocalKey) => {
    if (!snap) return;
    if (key === 'Insert') { setInserting((i) => !i); return; }
    if (key === 'EraseInput') {
      setEdits(erasedInput(snap.fields));
      const first = snap.fields.find((f) => !f.bypass);
      if (first) focusTarget.current = { id: first.id, offset: 0 };
      return;
    }
    // Erase EOF: the field the caret is in, from the caret on. From the Keys
    // menu, which takes the focus, the field the user was last in.
    const el = document.activeElement;
    const caret = el instanceof HTMLInputElement && el.dataset.field ? { id: el.dataset.field, offset: el.selectionStart ?? 0 } : lastField.current;
    const f = caret ? snap.fields.find((x) => x.id === caret.id) : undefined;
    if (!f || !caret || f.bypass) return;
    setEdits((e) => ({ ...e, [f.id]: erasedToEnd(e[f.id] ?? f.value, caret.offset) }));
    focusTarget.current = { id: f.id, offset: caret.offset };
  }, [snap]);

  const onAction = useCallback((a: Action) => submit(a.aid, a.fields), [submit]);
  const onButton = (a: ButtonAction) => {
    if ('url' in a) openUrl(a.url);
    else if ('macro' in a) runMacroButton(a);
    else onAction(a);
  };

  // Link buttons: fill the URL from the screen, including edits not sent yet.
  const openUrl = (template: string) => {
    const url = snap ? fillUrl(template, snap, edits) : undefined;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    else setNotice({ id: Date.now(), message: 'This button does not have a valid web address.' });
  };

  // Paging through the host for the user: Export, and components reading a
  // whole list (readList, readPages) or going to one of its rows (openRow).
  // One at a time; while one runs, the keyboard is its (Esc cancels).
  const exporting = useRef<ListJob | null>(null);
  const [exportProgress, setExportProgress] = useState<{ title: string; progress: Progress } | null>(null);
  /** Shows a component's read only if it takes a moment, so a short list doesn't flash a dialog. */
  const progressTimer = useRef<number | undefined>(undefined);
  const jobStep = (step: JobStep, from: ScreenSnapshot) => {
    const job = exporting.current;
    if (!job) return;
    if ('send' in step) {
      if (!job.quiet || exportProgressShown.current) setExportProgress({ title: job.title, progress: job.runner.progress });
      sendAid(step.send, {}, from.cursor);
      return;
    }
    exporting.current = null;
    window.clearTimeout(progressTimer.current);
    exportProgressShown.current = false;
    setExportProgress(null);
    job.done(step, from);
  };
  const exportProgressShown = useRef(false);
  /** Starts a job, or says why it can't start. */
  const startJob = (job: ListJob, first: () => JobStep): string | null => {
    if (!snap || !view) return 'Not connected to the host.';
    if (!pageKeys) return 'This host has no page keys to read the list with.';
    if (exporting.current || helping.current || macroJob.current) return 'Veneer is busy; try again in a moment.';
    if (!canSubmit) return 'The host is busy; try again in a moment.';
    if (Object.keys(edits).length > 0) return 'Press Enter or clear your changes first.';
    exporting.current = job;
    if (job.quiet) {
      progressTimer.current = window.setTimeout(() => {
        const now = exporting.current;
        if (now !== job) return;
        exportProgressShown.current = true;
        setExportProgress({ title: job.title, progress: job.runner.progress });
      }, QUIET_MS);
    }
    jobStep(first(), snap);
    return null;
  };
  const startExport = (format: ExportFormat) => {
    const table = view && listOf(view);
    if (!snap || !table) return;
    const ex = new ListExporter(table, screenId(snap));
    const name = fileBase(view.title);
    const title = view.title ?? 'List';
    const problem = startJob({
      title: 'Exporting list',
      runner: ex,
      done: (step) => {
        if ('error' in step && step.error) setNotice({ id: Date.now(), message: step.error });
        const sheet = 'sheet' in step ? step.sheet : undefined;
        if (!sheet) return;
        if (format === 'csv') download(`${name}.csv`, toCsv(sheet), 'text/csv;charset=utf-8');
        else download(`${name}.xlsx`, toXlsx(sheet, title), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      },
    }, () => ex.start());
    if (problem) setNotice({ id: Date.now(), message: problem.replace('first.', 'before exporting.') });
  };
  const cancelExport = () => exporting.current?.runner.cancel();

  // The last list a component read, to go back to its rows (openRow) and to
  // answer another component on the same screen without reading it again.
  const lastList = useRef<{ seq: number; id: string; at: { row: number; col: number }; table: TableItem; pages: TablePage[]; data: ListData } | null>(null);
  const reading = useRef<{ key: string; promise: Promise<ListData> } | null>(null);
  const readList = (options: ReadListOptions = {}): Promise<ListData> => {
    const table = view && listOf(view, options.at);
    if (!snap || !table) return Promise.reject(new Error('No list on this screen'));
    const id = screenId(snap);
    const at = { row: table.row, col: table.col };
    const key = `${seq}:${id}:${at.row}:${at.col}`;
    const known = lastList.current;
    if (known && known.seq === seq && known.id === id && known.at.row === at.row && known.at.col === at.col) return Promise.resolve(known.data);
    if (reading.current?.key === key) return reading.current.promise;
    const reader = new PageReader(listSource(table, id), tablePage(table, exportColumns(table)), options.maxPages ?? MAX_PAGES);
    const promise = new Promise<ListData>((resolve, reject) => {
      const problem = startJob({
        title: 'Reading the list',
        quiet: true,
        runner: reader,
        done: (step) => {
          if (reading.current?.promise === promise) reading.current = null;
          const s = step as ReadStep<TablePage>;
          if ('send' in s || !s.pages) { reject(new Error(('error' in s && s.error) || 'Reading the list was cancelled')); return; }
          const data = listData(table, s.pages, s.current ?? 0, s.complete ?? true);
          lastList.current = { seq: latest.current.seq, id, at, table, pages: s.pages, data };
          resolve(data);
        },
      }, () => reader.start());
      if (problem) reject(new Error(problem));
    });
    reading.current = { key, promise };
    promise.catch(() => { if (reading.current?.promise === promise) reading.current = null; });
    return promise;
  };
  const openRow = (record: ListRecord, option: string): Promise<void> => {
    const known = lastList.current;
    if (!snap || !view || !known) return Promise.reject(new Error('Read the list first'));
    const read = known.pages[record.page]?.rows[record.index];
    if (!read || JSON.stringify(read) !== JSON.stringify(record.cells)) return Promise.reject(new Error('That row is not in the list that was read'));
    const seeker = new RowSeeker(listSource(known.table, known.id), known.pages, record, option);
    return new Promise<void>((resolve, reject) => {
      const problem = startJob({
        title: 'Going to the row',
        quiet: true,
        runner: seeker,
        done: (step, from) => {
          const s = step as SeekStep;
          if (!('done' in s) || !s.fields) {
            if ('error' in s && s.error) { setNotice({ id: Date.now(), message: s.error }); reject(new Error(s.error)); }
            else reject(new Error('Cancelled'));
            return;
          }
          const [field] = Object.keys(s.fields);
          const f = from.fields.find((x) => x.id === field);
          // The job's own closure is from the screen it started on: send with the newest.
          latest.current.sendAid('Enter', s.fields, f ? { row: f.row, col: f.col } : from.cursor);
          resolve();
        },
      }, () => seeker.start(view, screenId(snap)));
      if (problem) reject(new Error(problem));
    });
  };
  const readPages = (options: ReadPagesOptions): Promise<PagesData> => {
    if (!snap || !view) return Promise.reject(new Error('Not connected to the host'));
    const from = Math.max(1, Math.floor(options.from));
    const to = Math.min(snap.rows, Math.floor(options.to));
    if (!(to >= from)) return Promise.reject(new Error('readPages: "from" and "to" must be rows on the screen, from <= to'));
    const reader = new PageReader(regionSource(screenId(snap), from, to), regionPage(view, from, to), options.maxPages ?? MAX_PAGES);
    return new Promise<PagesData>((resolve, reject) => {
      const problem = startJob({
        title: 'Reading every page',
        quiet: true,
        runner: reader,
        done: (step) => {
          const s = step as ReadStep<TextPage>;
          if ('send' in s || !s.pages) { reject(new Error(('error' in s && s.error) || 'Reading was cancelled')); return; }
          resolve({ pages: s.pages.map((p) => p.lines), current: s.current ?? 0, complete: s.complete ?? true });
        },
      }, () => reader.start());
      if (problem) reject(new Error(problem));
    });
  };

  // Macros (@veneer/screens MacroRun): each screen goes to the run, which says
  // what to type and press; keys go through the same checks as a user's.
  const macroJob = useRef<{ run: MacroRun; timer?: number; cancelled?: boolean } | null>(null);
  const [macroNote, setMacroNote] = useState<{ label: string; step: number; total: number } | null>(null);
  const finishMacro = (result: { error?: string; step?: number }) => {
    const job = macroJob.current;
    if (!job) return;
    window.clearTimeout(job.timer);
    macroJob.current = null;
    setMacroNote(null);
    const outcome = job.cancelled ? 'cancelled' : result.error ? 'failed' : 'done';
    session.send({ type: 'macro', macro: job.run.macro.name, outcome, ...(result.step ? { step: result.step } : {}) });
    if (outcome === 'failed') setNotice({ id: Date.now(), message: `${job.run.macro.label} stopped: ${result.error}` });
  };
  const macroStep = (result: MacroResult, from: ScreenSnapshot) => {
    const job = macroJob.current;
    if (!job) return;
    window.clearTimeout(job.timer);
    if ('done' in result) return finishMacro(result);
    if ('send' in result) {
      const { aid, fields, cursor } = result.send;
      // Mandatory entry and fill, as for a user pressing Enter.
      const problem = aid === 'Enter' ? checkFields(from.fields, fields) : null;
      if (problem) return finishMacro({ error: `Step ${result.step}: ${problem.message}`, step: result.step });
      setMacroNote({ label: job.run.macro.label, step: result.step, total: job.run.total });
      sendAid(aid, fields, cursor ?? from.cursor);
    }
    const ms = job.run.timeoutMs;
    if (ms !== undefined) job.timer = window.setTimeout(() => { if (macroJob.current === job) macroStep(job.run.timedOut(), from); }, ms);
  };
  const startMacro = (macro: Macro, given: Readonly<Record<string, string | undefined>>, start: MacroStart) => {
    if (macroJob.current || exporting.current || helping.current) return;
    let values: Record<string, string>;
    try {
      values = macroValues(macro, given);
    } catch (err) {
      if (!(err instanceof DefinitionError)) throw err;
      setNotice({ id: Date.now(), message: err.message });
      return;
    }
    const run = new MacroRun(macro, values, { start, user: session.user ?? undefined, check: macroFieldCheck });
    macroJob.current = { run };
    setMacroNote({ label: macro.label, step: 0, total: run.total });
    if (snap && canSubmit) macroStep(run.onScreen(snap), snap);
  };
  const cancelMacro = () => {
    const job = macroJob.current;
    if (!job) return;
    job.cancelled = true;
    finishMacro(job.run.cancel());
  };
  const macroNamed = (name: string) => screens.macros.find((m) => m.name === name);
  // A button: parameter values from the screen ({row:col}), including what was typed.
  const runMacroButton = (a: MacroAction) => {
    const macro = macroNamed(a.macro);
    if (!macro) { setNotice({ id: Date.now(), message: `There is no macro called “${a.macro}”.` }); return; }
    const given = Object.fromEntries(Object.entries(a.params ?? {}).map(([k, t]) => [k, snap ? fillText(t, snap, edits) : '']));
    startMacro(macro, given, 'here');
  };
  // Go to: macros chosen for the menu, asking for any values they need.
  const [asking, setAsking] = useState<Macro | null>(null);
  const goTo = (macro: Macro) => (Object.keys(macro.params ?? {}).length > 0 ? setAsking(macro) : startMacro(macro, {}, 'here'));
  // A deep link (?macro=name&param=value) runs in the new session it opened, after sign-on.
  const [link] = useState(() => linkedMacro(location.search));
  const linkStarted = useRef(false);
  const macroKeys = useRef({ cancel: cancelMacro });
  macroKeys.current = { cancel: cancelMacro };

  // Recording a macro in the designer's Macros panel: each key the user sends.
  const recording = useRef<MacroStep[] | null>(null);
  const [recorded, setRecorded] = useState<MacroStep[] | null>(null);
  const [macrosOpen, setMacrosOpen] = useState(false);
  const recordMacro = (on: boolean) => {
    recording.current = on ? [] : null;
    setRecorded(recording.current);
  };

  // Help (help/help.ts): the Help button presses the 5250 Help key, and the
  // help panel shows in a popover over the screen the user was on, which stays
  // drawn until help closes. What the user typed goes with the Help key, so the
  // host keeps it; it is put back here too, for hosts that redraw the screen.
  const lastField = useRef<Caret | null>(null);
  // The screen SysReq was pressed on, while a transfer waits for the menu.
  const transferring = useRef<string | null>(null);
  const helping = useRef<{ reader: HelpReader; edits: Record<string, string>; caret: Caret | null } | null>(null);
  const [help, setHelp] = useState<{ snap: ScreenSnapshot; view: ScreenView; page: HelpPage | null; anchor: string | undefined } | null>(null);
  const helpStep = (step: HelpStep, from: ScreenSnapshot) => {
    const job = helping.current;
    if (!job) return;
    if ('send' in step) {
      sendAid(step.send, {}, from.cursor);
      return;
    }
    if (step.reset) session.send({ type: 'reset' });
    if ('show' in step) {
      setHelp((h) => h && { ...h, page: step.show });
      return;
    }
    helping.current = null;
    setHelp(null);
    if (step.message) setNotice({ id: Date.now(), message: step.message });
    if (step.back) {
      setEdits(Object.fromEntries(Object.entries(job.edits).filter(([id, v]) => from.fields.some((f) => f.id === id && f.value !== v))));
      focusTarget.current = job.caret;
    }
  };
  const startHelp = () => {
    if (!snap || !view || !canSubmit || exporting.current || helping.current) return;
    // The field the user was in: focused now, or last (the button takes focus when tabbed to).
    const active = (document.activeElement as HTMLElement | null)?.dataset?.field;
    const caret = active ? caretOf(snap, document.activeElement as HTMLElement) : lastField.current;
    const f = caret ? snap.fields.find((x) => x.id === caret.id) : undefined;
    const cursor = f && caret ? caretPosition(snap, caret) ?? snap.cursor : currentCursor(snap, clickedCursor.current);
    helping.current = { reader: new HelpReader(screenId(snap)), edits, caret };
    setHelp({ snap, view, page: null, anchor: f?.id });
    sendAid('Help', edits, cursor);
  };
  const helpMore = () => { if (helping.current && snap && canSubmit) helpStep(helping.current.reader.more(), snap); };
  const helpKeys = useRef({ more: () => {}, close: () => {} });
  const helpClose = () => {
    const step = helping.current?.reader.close();
    if (step && snap) helpStep(step, snap);
  };
  helpKeys.current = { more: helpMore, close: helpClose };

  // System Request: the SysReq key, or SysReq then "1" on the System Request
  // line or menu to transfer to the secondary job (signing on to it the first
  // time). The host may show other screens first (Display Program Messages);
  // any key sent before the menu comes cancels the transfer.
  const systemRequest = (transfer: boolean) => {
    if (!connected || exporting.current || helping.current) return;
    transferring.current = transfer && snap ? screenId(snap) : null;
    session.send({ type: 'sysreq' });
  };

  // Custom JavaScript (custom/runtime.ts) reads and types into fields and presses keys.
  const sheet = useRef<HTMLFormElement>(null);
  const latest = useRef({ snap, seq, edits, submit, sendAid, readList, openRow, readPages });
  latest.current = { snap, seq, edits, submit, sendAid, readList, openRow, readPages };
  useEffect(() => {
    connectHost({
      getField: (id) => {
        const { snap: s, edits: e } = latest.current;
        return e[id] ?? s?.fields.find((f) => f.id === id)?.value;
      },
      setField: (id, value) => setEdits((e) => ({ ...e, [id]: value })),
      press: (aid, fields) => latest.current.submit(aid, fields),
      readList: (options) => latest.current.readList(options),
      openRow: (record, option) => latest.current.openRow(record, option),
      readPages: (options) => latest.current.readPages(options),
    });
  }, []);

  // The site's page-load script (global.js) runs once, when it first loads; a
  // changed one runs after a page reload.
  const siteScriptRan = useRef(false);
  useEffect(() => {
    if (siteScriptRan.current || !screens.site) return;
    siteScriptRan.current = true;
    if (screens.site.scripts.load) runSiteScript(screens.site.scripts.load);
  }, [screens.site]);

  // After each screen is drawn, run its scripts (SCREEN_EVENTS): the page's
  // `load` script when a different screen opens, then the page's `show`
  // script, its HTML boxes' scripts and the site's every-screen script, then
  // veneer.on('screen') handlers. Paused while designing; the design panel can
  // test a draft's scripts.
  const pageScripts = view?.scripts;
  const siteScreenScript = screens.site?.scripts.screen;
  const boxScripts = useMemo(() => JSON.stringify(
    [...(view?.items ?? []), ...(view?.window?.items ?? [])].flatMap((i) => (i.kind === 'html' && i.script ? [[`${i.row}:${i.col}`, i.script]] : [])),
  ), [view]);
  // The open screen (id + definition) and the cleanup its `load` script returned.
  const opened = useRef<{ key: string; cleanup?: (() => void) | undefined } | null>(null);
  const closeOpened = () => {
    opened.current?.cleanup?.();
    opened.current = null;
  };
  useEffect(() => {
    const root = sheet.current;
    // Help screens are not the user's screen: leave its scripts as they are.
    if (helping.current) return;
    if (!snap || !root || mode !== 'modern' || designing) {
      closeOpened();
      return;
    }
    const id = screenId(snap);
    const definition = view?.definition;
    setScreen(screenInfo(snap, id, definition?.id), root);
    const label = (event: string) => `the ${event} script of "${definition?.name}"`;
    const key = `${id}|${definition?.id ?? ''}`;
    if (opened.current?.key !== key) {
      closeOpened();
      opened.current = { key, cleanup: pageScripts?.load ? runScript(pageScripts.load, label('load')).cleanup : undefined };
    }
    const cleanups = [pageScripts?.show ? runScript(pageScripts.show, label('show')).cleanup : undefined];
    for (const [at, code] of JSON.parse(boxScripts) as Array<[string, string]>) {
      const box = root.querySelector<HTMLElement>(`[data-html="${at}"]`);
      if (box) cleanups.push(runScript(code, `the script of HTML at ${at} on "${definition?.name}"`, box).cleanup);
    }
    if (siteScreenScript) cleanups.push(runScript(siteScreenScript, 'global-screen.js').cleanup);
    notifyScreen();
    return () => { for (const c of cleanups) c?.(); };
    // A new screen, script or mode re-runs them; typing does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq, pageScripts, siteScreenScript, boxScripts, mode, designing]);

  // Each new screen: once it unlocks, replay type-ahead and place the cursor.
  useEffect(() => {
    if (!snap) return;
    clickedCursor.current = null;
    if (helping.current && view) {
      if (snap.keyboardLocked && !snap.error) return;
      awaitingNow.current = false;
      setAwaitingSeq(null);
      helpStep(helping.current.reader.onScreen(view, screenId(snap), Boolean(snap.error)), snap);
      return;
    }
    // An error while exporting is the host refusing a page key (top or bottom
    // of the list); the next key resets it, as on a 5250.
    if (snap.error && exporting.current && view) {
      awaitingNow.current = false;
      setAwaitingSeq(null);
      jobStep(exporting.current.runner.onScreen(view, screenId(snap), true), snap);
      return;
    }
    // A host error stops a macro, leaving the user on that screen to see it.
    if (snap.error && macroJob.current) {
      awaitingNow.current = false;
      setAwaitingSeq(null);
      macroStep(macroJob.current.run.onScreen(snap), snap);
      return;
    }
    if (snap.error) {
      // As on a 5250, an error discards anything typed ahead.
      transferring.current = null;
      queue.current = [];
      setQueued(0);
      awaitingNow.current = false;
      setAwaitingSeq(null);
      setEdits({});
      return;
    }
    if (snap.keyboardLocked) return;
    lastField.current = null;
    if (transferring.current && snap.fields.some((f) => !f.bypass) && screenId(snap) !== transferring.current) {
      transferring.current = null;
      const field = sysreqField(snap);
      if (field) {
        awaitingNow.current = false;
        setAwaitingSeq(null);
        sendAid('Enter', { [field.id]: '1' }, { row: field.row, col: field.col });
        return;
      }
    }
    // Any newer unlocked screen answers the AID we were waiting on.
    awaitingNow.current = false;
    setNotice(null);
    setAwaitingSeq(null);
    if (exporting.current && view) {
      jobStep(exporting.current.runner.onScreen(view, screenId(snap)), snap);
      return;
    }
    if (macroJob.current) {
      macroStep(macroJob.current.run.onScreen(snap), snap);
      // While it drives, the screen is the macro's. Waiting to start, or just
      // finished, the screen is the user's as usual (focus at the host's cursor).
      if (macroJob.current && macroJob.current.run.step > 0) return;
    }
    const start = { edits: {}, caret: caretAtCursor(snap) };
    const result: ReplayResult = queue.current.length > 0 ? replay(snap, start, queue.current) : { state: start, rest: [] };
    queue.current = result.rest;
    setQueued(result.rest.length);
    setEdits(result.state.edits);
    focusTarget.current = result.state.caret;
    if (result.aid) {
      const problem = result.aid === 'Enter' ? checkFields(snap.fields, result.state.edits) : null;
      if (problem) {
        // Stop replaying, as a 5250 does on an operator error.
        queue.current = [];
        setQueued(0);
        setNotice({ id: Date.now(), message: problem.message });
        focusTarget.current = endOf(snap, result.state.edits, problem.id);
        setEdits(result.state.edits);
      } else {
        const caret = result.state.caret;
        sendAid(result.aid, result.state.edits, (caret && caretPosition(snap, caret)) ?? snap.cursor);
      }
    }
    // Only a new screen should trigger this, not edits or the callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  // A deep link's macro starts once the macros and the first screen are here.
  // After the screen effect above, so what it says isn't cleared by that screen.
  useEffect(() => {
    if (!link || linkStarted.current || screens.site === null || !snap) return;
    linkStarted.current = true;
    const macro = macroNamed(link.name);
    if (!macro) setNotice({ id: Date.now(), message: `There is no macro called “${link.name}”.` });
    else startMacro(macro, link.given, 'link');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screens.site, snap]);

  // Apply a pending focus after rendering.
  useEffect(() => {
    const target = focusTarget.current;
    // The screen is inert while help shows: focus it once help has closed.
    if (!target || designingNow.current || help) return;
    focusTarget.current = null;
    const el = fieldElement(target.id) ?? document.querySelector<HTMLElement>('[data-field]');
    if (el) revealField(el);
    el?.focus();
    if (el instanceof HTMLInputElement && el.dataset.field === target.id) {
      try { el.setSelectionRange(target.offset, target.offset); } catch { /* password inputs on some browsers */ }
    }
    if (el instanceof HTMLTextAreaElement) {
      // A text area: the caret goes to the target field's line.
      const line = (el.dataset.fields ?? '').split(' ').indexOf(target.id);
      if (line >= 0) { const i = indexAt(el.value, line, target.offset); el.setSelectionRange(i, i); }
    }
  });

  // Keyboard: Enter, F1-F24, PageUp/PageDown, Esc = Reset; queued while the host is busy.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Keys typed in the Macros panel or a dialog are theirs, not the host's.
      if (ownKeys(e.target)) return;
      // While a macro runs, the keyboard is the macro's; Esc stops it. Waiting to
      // start (a deep link at sign-on), the keyboard is the user's, but Esc still stops it.
      if (macroJob.current) {
        if (e.key === 'Escape') { e.preventDefault(); macroKeys.current.cancel(); return; }
        if (macroJob.current.run.step > 0) {
          if (keyAction(e) || e.key.length === 1) e.preventDefault();
          return;
        }
      }
      // While exporting, the keyboard is the exporter's; Esc cancels.
      if (exporting.current) {
        e.preventDefault();
        if (e.key === 'Escape') exporting.current.runner.cancel();
        return;
      }
      // While help is open: Esc closes it, Page Down shows more; other keys wait.
      if (helping.current) {
        if (e.key === 'Escape') { e.preventDefault(); helpKeys.current.close(); }
        else if (e.key === 'PageDown') { e.preventDefault(); helpKeys.current.more(); }
        else if (keyAction(e)) e.preventDefault();
        return;
      }
      // While designing, keys belong to the design panel, not the host.
      if (designingNow.current) return;
      if (typingAheadNow.current || awaitingNow.current) {
        const key = typedKey(e, keyContextNow.current);
        if (!key) return;
        e.preventDefault();
        if (queue.current.length < MAX_TYPEAHEAD) {
          queue.current.push(key);
          setQueued(queue.current.length);
        }
        return;
      }
      const action = keyAction(e, keyContextNow.current);
      if (!action) return;
      e.preventDefault();
      if (action === 'Reset') session.send({ type: 'reset' });
      else if (isLocalKey(action)) localKeyNow.current(action);
      else submit(action);
    };
    // Text that arrives without a usable keydown (mobile keyboards, IMEs, paste).
    const onBeforeInput = (e: InputEvent) => {
      if (ownKeys(e.target)) return;
      if (exporting.current) { e.preventDefault(); return; }
      if (!typingAheadNow.current && !awaitingNow.current) return;
      e.preventDefault();
      if (e.inputType !== 'insertText' || !e.data) return;
      for (const ch of e.data) {
        if (queue.current.length < MAX_TYPEAHEAD) queue.current.push({ kind: 'char', ch });
      }
      setQueued(queue.current.length);
    };
    window.addEventListener('keydown', onKey);
    // (Typing ahead ignores the local keys: they need the screen they are pressed on.)
    window.addEventListener('beforeinput', onBeforeInput, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeinput', onBeforeInput, true);
    };
  }, [submit, session]);

  const localKeyNow = useRef(localKey);
  localKeyNow.current = localKey;

  const toggleMode = () => {
    const next = mode === 'modern' ? 'classic' : 'modern';
    setMode(next);
    if (snap) focusTarget.current = caretAtCursor(snap);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* ignore */ }
  };

  // While help is open, the screen the user pressed Help on stays drawn.
  const screenView = help?.view ?? view;
  const screenSnap = help?.snap ?? snap;
  // Keys and buttons wait while help shows (the host is showing help, not this screen).
  const keysEnabled = canSubmit && !help;

  // An active pop-up window owns the function keys and the message.
  const keys: FunctionKey[] = (screenView?.window ? screenView.window.functionKeys : screenView?.functionKeys) ?? [];
  const message = screenView?.window ? screenView.window.message : screenView?.message;
  // Lists a component took the place of still have Export and the page keys.
  const hasTable = [...(screenView?.items ?? []), ...(screenView?.window?.items ?? []), ...(screenView?.hiddenTables ?? [])].some((i) => i.kind === 'table');
  const busy = typingAhead;
  // Veneer's own sign-on page is up: no host session yet.
  const signingOn = session.signOn !== null && !screenSnap && session.state !== 'closed';
  const goToMacros = screens.macros.filter((m) => m.menu && (!m.host || m.host === hostType));

  return (
    <div className={`app${designing ? ' designing' : macrosOpen ? ' designing macros-open' : ''}`} data-screen={screenView?.definition?.id}>
      {screens.site?.css && <style>{screens.site.css}</style>}
      {mode === 'modern' && screenView?.css && <style>{screenView.css}</style>}
      <div className={`busy-bar${busy ? ' on' : ''}`} aria-hidden />
      <header className="topbar">
        {brand ? <img className="brand" src={themeLogo ?? brand.logo} alt={brand.name} /> : <span className="brand" />}
        <div className="titles">
          <h1>{(mode === 'modern' && screenView?.title) || brand?.name}</h1>
          {mode === 'modern' && screenView && screenView.meta.length > 0 && (
            <div className="meta">
              {screenView.meta.map((m) => {
                const cls = `meta-item${m.role !== 'normal' ? ` role-${m.role}` : ''}`;
                if (!designView) return <span key={`${m.row}:${m.col}`} className={cls}>{m.text}</span>;
                // In the designer, header items are selectable to hide, rename or restyle.
                const selected = selection?.at.row === m.row && selection.at.col === m.col;
                return (
                  <button
                    key={`${m.row}:${m.col}`} type="button" title="Select to hide, rename or restyle"
                    className={`${cls} meta-pick${m.hidden ? ' ghost' : ''}${selected ? ' selected' : ''}`}
                    onClick={() => setSelectedAt({ row: m.row, col: m.col })}
                  >{m.text}</button>
                );
              })}
            </div>
          )}
        </div>
        <div className="top-actions">
          {screenView?.definition && mode === 'modern' && (
            <span className="custom-badge" title={`Customized: ${screenView.definition.name}`}>Customized</span>
          )}
          <span
            className={`status status-${signingOn ? 'signon' : session.state}`}
            title={is3270 && busy ? 'X SYSTEM: the keyboard waits for the host. If it stays locked, Esc (Reset) unlocks it.' : undefined}
          >
            {signingOn ? 'Not signed on' : statusText(session.state, busy, hostType)}
            {queued > 0 && <span className="typeahead" title="Keys typed ahead">{queued} typed ahead</span>}
          </span>
          {is3270 && inserting && connected && <span className="typeahead" title="Typing inserts, pushing the rest along. Insert switches back to typing over.">Insert</span>}
          {goToMacros.length > 0 && !designing && !signingOn && (
            <DropMenu label="Go to" title="Shortcuts to screens you use often" disabled={!keysEnabled || macroNote !== null}
              items={goToMacros.map((m) => ({ label: m.label, title: `Run the ${m.label} macro`, onPick: () => goTo(m) }))} />
          )}
          {screens.designer && screenSnap && !designing && !help && (
            <button type="button" className="ghost mode-toggle" onClick={() => setMacrosOpen(true)} title="Record, edit and test macros">Macros</button>
          )}
          {screens.designer && screenSnap && !designing && !help && (
            <button type="button" className="ghost mode-toggle" onClick={startDesign}>Design</button>
          )}
          {!designing && !signingOn && (
            <button type="button" className="ghost mode-toggle" onClick={toggleMode}>
              {mode === 'modern' ? 'Classic view' : 'Modern view'}
            </button>
          )}
          {session.state !== 'closed' && !designing && !signingOn && (
            <DropMenu label="System" title="System Request and Attention keys" disabled={!connected || Boolean(help)} items={is3270 ? [
              { label: 'System Request', title: 'The 3270 SysReq key: to the system (SSCP) session and back', onPick: () => systemRequest(false) },
              { label: 'Attention', title: 'The 3270 Attn key, which interrupts a command', onPick: () => session.send({ type: 'attn' }) },
              { label: 'New session', title: 'Another session, in a new browser tab', onPick: openSession },
            ] : [
              { label: 'System Request', title: 'The 5250 SysReq key', onPick: () => systemRequest(false) },
              { label: 'Transfer to secondary job', title: 'SysReq, option 1', onPick: () => systemRequest(true) },
              { label: 'Attention', title: 'The 5250 Attn key', onPick: () => session.send({ type: 'attn' }) },
              { label: 'New session', title: 'Another session, in a new browser tab', onPick: openSession },
            ]} />
          )}
          {session.state !== 'closed' && (
            <button type="button" className="ghost" onClick={session.disconnect}>Disconnect</button>
          )}
        </div>
      </header>

      <main className="stage">
        {message && mode === 'modern' && (
          <div className={`banner banner-${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
            <span>{message.text}</span>
            {message.kind === 'error' && (
              <button type="button" className="ghost" onClick={() => session.send({ type: 'reset' })}>Reset (Esc)</button>
            )}
          </div>
        )}
        <Toast error={notice} />
        {session.notice && screenSnap && <div className="banner" role="status"><span>{session.notice}</span></div>}
        {help && (
          <HelpPopover page={help.page} anchor={help.anchor} busy={!canSubmit} onMore={helpMore} onClose={helpClose} />
        )}

        {screenSnap && screenView ? (
          <form
            className="sheet" ref={sheet} onSubmit={(e) => e.preventDefault()} autoComplete="off" inert={Boolean(help) || previewing}
            onBlurCapture={(e) => { if (screenSnap && (e.target as HTMLElement).dataset.field) lastField.current = caretOf(screenSnap, e.target as HTMLElement); }}
          >
            {mode === 'modern' && screenView.buttons.length > 0 && (
              <div className="screen-actions">
                {screenView.buttons.map(({ label, action }, i) => ('url' in action
                  ? <button key={i} type="button" className="link-button" title="Opens in a new tab" onClick={() => openUrl(action.url)}>{label}</button>
                  : <button key={i} type="button" disabled={!keysEnabled || macroNote !== null} onClick={() => onButton(action)}>{label}</button>
                ))}
              </div>
            )}
            {mode === 'modern'
              ? <ModernScreen view={screenView} binding={binding} locked={!keysEnabled} onAction={onAction}
                  history={screenView.lineMode && !designing ? consoleHistory : undefined}
                  onCursor={(row, col) => { clickedCursor.current = { row, col }; }}
                  design={designView ? { selected: selection?.at ?? null, onSelect: selectOnScreen, onMove: moveItem, onResize: resizeBox } : undefined} />
              : <ClassicScreen snap={screenSnap} binding={binding} />}
          </form>
        ) : signingOn && session.signOn ? (
          <SignOnPage name={brand?.name ?? 'IBM i'} password={session.signOn.password}
            error={session.signOn.error} waiting={session.signOn.waiting} send={session.send} />
        ) : (
          session.state !== 'closed' && <div className="placeholder">Connecting to {is3270 ? 'the mainframe' : 'IBM i'}…</div>
        )}
      </main>

      {screenSnap && (
        <footer className="keybar">
          <button type="button" className="primary" disabled={!keysEnabled} onClick={() => submit('Enter')}>
            Enter
          </button>
          {keys.map((k) => (
            <button key={k.aid} type="button" disabled={!keysEnabled} onClick={() => submit(k.aid)}>
              <kbd>{keyHint(k.aid, hostType)}</kbd>{k.label}
            </button>
          ))}
          {(hasTable || mode === 'classic') && pageKeys && (
            <>
              <button type="button" disabled={!keysEnabled} title={is3270 ? `Page Up: sends ${keyHint(pageKeys.up, hostType)}` : undefined} onClick={() => submit('PageUp')}><kbd>PgUp</kbd>Previous</button>
              <button type="button" disabled={!keysEnabled} title={is3270 ? `Page Down: sends ${keyHint(pageKeys.down, hostType)}` : undefined} onClick={() => submit('PageDown')}><kbd>PgDn</kbd>Next</button>
            </>
          )}
          {hasTable && pageKeys && mode === 'modern' && !designing && <ExportMenu disabled={!canSubmit || Boolean(help)} onExport={startExport} />}
          {is3270 && !designing && (
            <DropMenu label="Keys" title="Every 3270 key, and the editing keys" disabled={!keysEnabled} up start columns={6} items={[
              ...KEYS_3270.map((aid) => ({ label: keyHint(aid, hostType), title: KEY_TITLES[aid] ?? `The ${keyHint(aid, hostType)} key`, onPick: () => submit(aid) })),
              { label: 'Erase Input', title: 'Blank every input field', onPick: () => localKey('EraseInput'), wide: true },
              { label: 'Erase EOF (End)', title: 'Blank the field from the caret to its end', onPick: () => localKey('EraseEOF'), wide: true },
              { label: inserting ? 'Insert (now inserting)' : 'Insert (now typing over)', title: 'Switch between typing over and inserting (the Insert key)', onPick: () => localKey('Insert'), wide: true },
            ]} />
          )}
          {!designing && !is3270 && (
            <button
              type="button"
              className="help-button"
              disabled={!canSubmit || Boolean(help)}
              title="Help for the field you are in (the 5250 Help key)"
              onClick={() => (mode === 'modern' ? startHelp() : submit('Help'))}
            >
              <kbd>?</kbd>Help
            </button>
          )}
        </footer>
      )}

      {designing && draft && screenSnap && screenView && (
        <DesignPanel
          snap={screenSnap}
          view={screenView}
          draft={draft}
          setDraft={setDraft}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          onUndo={() => setHistory(undo)}
          onRedo={() => setHistory(redo)}
          previewing={previewing}
          onPreview={setPreviewing}
          saved={savedDraft}
          existing={draftExisting}
          selection={selection}
          definitions={screens.screens}
          site={screens.site ?? { css: '', scripts: { load: '', screen: '' } }}
          theme={screens.theme}
          components={screens.components}
          macros={screens.macros}
          onSelect={setSelectedAt}
          clickedAt={selectedAt}
          joining={joining}
          onJoining={setJoining}
          tokenRequired={screens.tokenRequired}
          onPick={pickDefinition}
          onSaved={screens.reload}
          onClose={stopDesign}
        />
      )}

      {macroNote && (
        <div className="macro-note" role="status">
          <span>{macroNote.step === 0 ? `${macroNote.label} starts when its first screen appears.` : `${macroNote.label}: step ${macroNote.step} of ${macroNote.total}…`}</span>
          <button type="button" className="ghost" onClick={cancelMacro}>Stop (Esc)</button>
        </div>
      )}

      {asking && (
        <MacroValuesDialog macro={asking} onCancel={() => setAsking(null)} onRun={(values) => { setAsking(null); startMacro(asking, values, 'here'); }} />
      )}

      {macrosOpen && !designing && screenSnap && screenView && (
        <MacrosPanel
          snap={screenSnap}
          view={screenView}
          macros={screens.macros}
          host={hostType}
          tokenRequired={screens.tokenRequired}
          recorded={recorded}
          onRecord={recordMacro}
          running={macroNote !== null}
          onTest={(macro, values) => startMacro(macro, values, 'here')}
          onSaved={screens.reload}
          onClose={() => { recordMacro(false); setMacrosOpen(false); }}
        />
      )}

      {exportProgress && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="export-title">
          <div className="dialog">
            <h2 id="export-title">{exportProgress.title}</h2>
            <p role="status">
              {exportProgress.progress.phase === 'rewinding' ? 'Going to the top of the list…'
                : exportProgress.progress.phase === 'paging' ? `Page ${exportProgress.progress.pages}, ${exportProgress.progress.rows} rows so far…`
                : exportProgress.progress.phase === 'seeking' ? 'Paging to the row…'
                : `${exportProgress.progress.rows} rows. Going back to where you were…`}
            </p>
            <button type="button" className="ghost" disabled={exportProgress.progress.phase === 'returning'} onClick={cancelExport}>Cancel (Esc)</button>
          </div>
        </div>
      )}

      {session.state === 'closed' && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="closed-title">
          <div className="dialog">
            <h2 id="closed-title">Session ended</h2>
            <p>{session.closedReason ?? `The connection to ${is3270 ? 'the mainframe' : 'the IBM i'} was closed.`}</p>
            <div className="dialog-actions">
              <button type="button" className="primary" autoFocus onClick={session.newSession}>Start a new session</button>
              <button type="button" className="ghost" onClick={openSession}>New session in a new tab</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Whether a key belongs to a side panel, dialog or the sign-on page (its inputs and buttons) rather than the screen. */
function ownKeys(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.macros-panel, .overlay, .signon-page') !== null;
}

/** Another session: Veneer in a new browser tab, which starts its own. */
function openSession() {
  window.open(`${location.pathname}?${NEW_SESSION}`, '_blank', 'noopener');
}

/** What the 3270 keys in the Keys menu do. */
const KEY_TITLES: Partial<Record<AidName, string>> = {
  PA1: 'Program attention 1: sends no field data',
  PA2: 'Program attention 2: sends no field data (often: redisplay)',
  PA3: 'Program attention 3: sends no field data',
  Clear: 'Blanks the screen and tells the host (Pause key)',
};

function statusText(state: string, busy: boolean, host: string): string {
  // A 3270 shows "X SYSTEM" while its keyboard waits for the host.
  if (state === 'connected') return busy ? (host === '3270' ? 'X SYSTEM' : 'Working…') : 'Connected';
  if (state === 'connecting') return 'Connecting…';
  return 'Disconnected';
}

/** A caret at the end of a field's current value, for correcting it. */
function endOf(snap: ScreenSnapshot, values: Record<string, string>, id: string): Caret {
  const value = values[id] ?? snap.fields.find((f) => f.id === id)?.value ?? '';
  return { id, offset: value.length };
}

/** The element that takes focus for a field: its input, or the text area it is a line of. */
function fieldElement(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-field="${id}"]`)
    ?? [...document.querySelectorAll<HTMLElement>('[data-fields]')].find((el) => el.dataset.fields!.split(' ').includes(id)) ?? null;
}

/** The caret in a focused field input (in a text area, in the field of the caret's line). */
function caretOf(snap: ScreenSnapshot, el: HTMLElement): Caret | null {
  if (el instanceof HTMLTextAreaElement && el.dataset.fields) {
    const ids = el.dataset.fields.split(' ');
    const line = Math.min(lineAt(el.value, el.selectionStart).line, ids.length - 1);
    const f = snap.fields.find((x) => x.id === ids[line]);
    return f ? { id: f.id, offset: Math.min(lineAt(el.value, el.selectionStart).col, f.length - 1) } : null;
  }
  // A radio button other than the group's tab stop names its field in data-field-of.
  const id = el.dataset.field ?? el.dataset.fieldOf;
  const f = id ? snap.fields.find((x) => x.id === id) : undefined;
  if (!f) return null;
  const offset = el instanceof HTMLInputElement && el.type !== 'radio' ? Math.min(el.selectionStart ?? 0, f.length - 1) : 0;
  return { id: f.id, offset };
}

/** The cursor to report: the caret in the focused field, else the last clicked text. */
function currentCursor(snap: ScreenSnapshot, clicked: { row: number; col: number } | null) {
  const el = document.activeElement as HTMLElement | null;
  const caret = el?.dataset ? caretOf(snap, el) : null;
  if (caret) return caretPosition(snap, caret) ?? snap.cursor;
  return clicked ?? snap.cursor;
}

function Toast({ error }: { error: { id: number; message: string } | null }) {
  const [visible, setVisible] = useState<typeof error>(null);
  useEffect(() => {
    setVisible(error);
    if (!error) return;
    const t = window.setTimeout(() => setVisible(null), 5000);
    return () => window.clearTimeout(t);
  }, [error]);
  return visible ? <div className="toast" role="alert">{visible.message}</div> : null;
}

/** The values a macro needs before it runs from the Go to menu. */
function MacroValuesDialog({ macro, onRun, onCancel }: { macro: Macro; onRun: (values: Record<string, string>) => void; onCancel: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const params = Object.entries(macro.params ?? {});
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="macro-values-title" onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
      <form className="dialog" onSubmit={(e) => { e.preventDefault(); onRun(values); }}>
        <h2 id="macro-values-title">{macro.label}</h2>
        {params.map(([name, p], i) => (
          <label key={name} className="dialog-field">
            <span>{p.label ?? name}{p.required ? '' : ' (optional)'}</span>
            <input autoFocus={i === 0} value={values[name] ?? ''} required={p.required} onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))} />
          </label>
        ))}
        <div className="dialog-actions">
          <button type="submit" className="primary">Go</button>
          <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
