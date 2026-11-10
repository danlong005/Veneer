// Reading a whole list (or any paged screen): page up to the top, down to the
// bottom collecting each page, then back so the user is where they started.
// The reader only decides the next key; the app sends it and reports each new
// screen. Export (Excel/CSV), components' readList() and readPages() all use it.

import type { Role } from '@veneer/screens';
import type { AidName } from '@veneer/terminal';
import type { Item, ScreenView, TableItem } from '../transform/types.ts';
import { exportColumns, headerOf, pageRows, type Sheet } from './sheet.ts';

/** Stop after this many pages, whatever the host says. */
export const MAX_PAGES = 500;

export interface Progress {
  phase: 'rewinding' | 'paging' | 'returning' | 'seeking';
  pages: number;
  rows: number;
}

/** What to read on each page, and how to tell the pages apart. */
export interface PageSource<P> {
  /** This screen's page, or undefined when the screen is no longer the one being read. */
  read(view: ScreenView, screenId: string): P | undefined;
  /** The same text gives the same signature: a page key that didn't move. */
  signature(page: P): string;
  /** The host says there is more below (a list's More...). */
  more(page: P): boolean;
  /** How many rows (or lines) the page adds to the count shown to the user. */
  size(page: P): number;
}

export interface ReadOptions {
  /** Page back to the page reading started on (default true). */
  goBack?: boolean;
}

export type ReadStep<P> =
  | { send: AidName }
  /** Finished: `pages` (top to bottom) unless cancelled or failed; `current` is the user's page. */
  | { done: true; pages?: P[]; current?: number; complete?: boolean; error?: string };

/**
 * Pages up to the top, then down to the bottom collecting every page, then
 * back to the page the user was on. The top and bottom are where a page key
 * no longer changes the page (or the host answers with an error, such as
 * "roll past the first record"); the source's `more` also ends it.
 */
export class PageReader<P> {
  private readonly source: PageSource<P>;
  private readonly maxPages: number;
  /** Page back to where reading started (a user's screen); off for a macro API run, which ends there. */
  private readonly goBack: boolean;
  private readonly pages: P[] = [];
  private phase: Progress['phase'] = 'rewinding';
  /** Pages from the user's page: negative above it, positive below. */
  private pos = 0;
  /** Where the user's page is among `pages`, once the top is found. */
  private current = 0;
  /** The page key last sent, to undo `pos` if the page didn't move. */
  private moved = 0;
  private rows = 0;
  private lastPage: string;
  private cancelled = false;
  private stopped = false;
  private error: string | undefined;

  constructor(source: PageSource<P>, first: P, maxPages = MAX_PAGES, opts: ReadOptions = {}) {
    this.source = source;
    this.maxPages = maxPages;
    this.goBack = opts.goBack ?? true;
    this.lastPage = source.signature(first);
  }

  get progress(): Progress {
    return { phase: this.phase, pages: this.pages.length, rows: this.rows };
  }

  /** The first step, from the page showing when reading started. */
  start(): ReadStep<P> {
    return this.page('PageUp');
  }

  cancel(): void {
    this.cancelled = true;
  }

  /**
   * A new screen arrived. `refused` means the host answered the page key with
   * an error (the page did not move).
   */
  onScreen(view: ScreenView, screenId: string, refused = false): ReadStep<P> {
    const page = this.source.read(view, screenId);
    const stayed = refused || (page !== undefined && this.source.signature(page) === this.lastPage);
    if (stayed) this.pos -= this.moved;
    // Returning: stop if the page won't move rather than press the key forever.
    if (this.phase === 'returning') return page !== undefined && !stayed ? this.back() : this.finish();
    if (page === undefined) {
      this.error = 'The screen changed while reading the list, so it stopped.';
      return this.back();
    }
    if (this.cancelled) return this.back();
    this.lastPage = this.source.signature(page);

    if (this.phase === 'rewinding') {
      if (!stayed && -this.pos < this.maxPages) return this.page('PageUp');
      // At the top: collect from here down.
      this.phase = 'paging';
      this.current = -this.pos || 0;
      return this.collect(page);
    }
    if (stayed) return this.back();
    return this.collect(page);
  }

  private collect(page: P): ReadStep<P> {
    this.pages.push(page);
    this.rows += this.source.size(page);
    if (!this.source.more(page)) return this.back();
    if (this.pages.length >= this.maxPages) {
      this.stopped = true;
      return this.back();
    }
    return this.page('PageDown');
  }

  private page(aid: 'PageUp' | 'PageDown'): ReadStep<P> {
    this.moved = aid === 'PageDown' ? 1 : -1;
    this.pos += this.moved;
    return { send: aid };
  }

  /** Head back to the user's page, or finish when there. */
  private back(): ReadStep<P> {
    this.phase = 'returning';
    if (this.pos === 0 || !this.goBack) return this.finish();
    return this.page(this.pos > 0 ? 'PageUp' : 'PageDown');
  }

  private finish(): ReadStep<P> {
    if (this.error) return { done: true, error: this.error };
    if (this.cancelled) return { done: true };
    return { done: true, pages: this.pages, current: Math.min(this.current, Math.max(0, this.pages.length - 1)), complete: !this.stopped };
  }
}

// ---- lists ---------------------------------------------------------------------

/** One page of a list, in the columns read (the option column left out). */
export interface TablePage {
  rows: string[][];
  /** The same cells untrimmed, so indenting survives (a tree's levels). */
  raw: string[][];
  /** Each row's role from a style rule, or null. */
  roles: Array<Role | null>;
  /** Each row's option field id, or null. Ids are screen positions, so they hold for that page only. */
  options: Array<string | null>;
  more: boolean;
}

/**
 * Every list on the screen, in screen order: drawn ones (in the pop-up window
 * first, if one is open) and those a customization hid for a component.
 */
function listsOf(view: ScreenView): TableItem[] {
  const items: Item[] = view.window ? view.window.items : view.items;
  return [...items, ...(view.hiddenTables ?? [])].filter((i): i is TableItem => i.kind === 'table');
}

/** The list to read: the one at `at`, else the first (in the pop-up window if one is open). */
export function listOf(view: ScreenView, at?: { row: number; col: number }): TableItem | undefined {
  const lists = listsOf(view);
  return at ? lists.find((t) => t.row === at.row && t.col === at.col) : lists[0];
}

/** A list's page: the text of the columns that are read, and each row's option field. */
export function tablePage(table: TableItem, columns: number[]): TablePage {
  const option = (r: TableItem['rows'][number]) => r.cells.find((c) => c.options && c.field && !c.field.bypass)?.field!.id ?? null;
  return {
    rows: pageRows(table, columns),
    raw: table.rows.map((r) => columns.map((k) => { const c = r.cells[k]; return c?.field ? c.field.value : c?.text ?? ''; })),
    roles: table.rows.map((r) => r.role ?? null),
    options: table.rows.map(option),
    more: table.more,
  };
}

/** Reads the pages of the list at the table's place on this screen. */
export function listSource(table: TableItem, screenId: string): PageSource<TablePage> {
  const at = { row: table.row, col: table.col };
  const columns = exportColumns(table);
  return {
    read: (view, id) => {
      const t = id === screenId ? listOf(view, at) : undefined;
      return t ? tablePage(t, columns) : undefined;
    },
    signature: (p) => JSON.stringify(p.rows),
    more: (p) => p.more,
    size: (p) => p.rows.length,
  };
}

/** Export: the whole list as a sheet (the option column left out). */
export class ListExporter {
  private readonly reader: PageReader<TablePage>;
  private readonly header: string[];

  constructor(table: TableItem, screenId: string, maxPages = MAX_PAGES, opts: ReadOptions = {}) {
    const columns = exportColumns(table);
    this.header = headerOf(table, columns);
    this.reader = new PageReader(listSource(table, screenId), tablePage(table, columns), maxPages, opts);
  }

  get progress(): Progress { return this.reader.progress; }
  start(): Step { return this.step(this.reader.start()); }
  cancel(): void { this.reader.cancel(); }
  onScreen(view: ScreenView, screenId: string, refused = false): Step {
    return this.step(this.reader.onScreen(view, screenId, refused));
  }

  private step(s: ReadStep<TablePage>): Step {
    if ('send' in s) return s;
    if (s.error) return { done: true, error: s.error };
    if (!s.pages) return { done: true };
    const sheet: Sheet = { header: this.header, rows: s.pages.flatMap((p) => p.rows) };
    return { done: true, sheet, ...(s.complete === false ? { complete: false } : {}) };
  }
}

export type Step =
  | { send: AidName }
  /** Finished: `sheet` unless cancelled or failed; `complete: false` when it stopped at the page limit. */
  | { done: true; sheet?: Sheet; complete?: boolean; error?: string };

// ---- a region of the screen (spool files, long text) ---------------------------

/** One page of screen text: the lines of the region, untrimmed. */
export interface TextPage {
  lines: string[];
  more: boolean;
}

/** Text that says this is the last page: 5250 "Bottom", ISPF/SDSF "BOTTOM OF DATA". */
export const BOTTOM = /(^|\s)Bottom\s*$|\bBOTTOM OF DATA\b/;

/**
 * Reads rows `from`..`to` (1-based, inclusive) of the same screen on every
 * page. The last page is the one showing "Bottom" (or "BOTTOM OF DATA")
 * anywhere on the screen, or the one a page key won't move past.
 */
export function regionSource(screenId: string, from: number, to: number): PageSource<TextPage> {
  return {
    read: (view, id) => (id === screenId ? regionPage(view, from, to) : undefined),
    signature: (p) => p.lines.join('\n'),
    more: (p) => p.more,
    size: (p) => p.lines.length,
  };
}

export function regionPage(view: ScreenView, from: number, to: number): TextPage {
  const lines = view.snapshot.lines;
  return {
    lines: lines.slice(Math.max(0, from - 1), Math.min(lines.length, to)),
    more: !lines.some((l) => BOTTOM.test(l)),
  };
}

// ---- going to a row of a list that was read -------------------------------------

export type SeekStep =
  | { send: AidName }
  /** Finished: on the row's page; `fields` types the option into the row, then press Enter. */
  | { done: true; fields?: Record<string, string>; error?: string };

/**
 * From the page showing now, pages to a row of a list read earlier and types
 * an option into it. The page showing is found by its text among the pages
 * read, so it works after the user has paged; a page that doesn't look as it
 * did when read (the list changed) stops it.
 */
export class RowSeeker {
  private readonly source: PageSource<TablePage>;
  private readonly pages: string[];
  private readonly target: number;
  private readonly index: number;
  private readonly cells: string[];
  private readonly option: string;
  private pos = -1;
  private cancelled = false;

  constructor(source: PageSource<TablePage>, pages: TablePage[], row: { page: number; index: number }, option: string) {
    this.source = source;
    this.pages = pages.map((p) => source.signature(p));
    this.target = row.page;
    this.index = row.index;
    this.cells = pages[row.page]?.rows[row.index] ?? [];
    this.option = option;
  }

  get progress(): Progress {
    return { phase: 'seeking', pages: Math.abs(this.target - Math.max(this.pos, 0)), rows: 0 };
  }

  cancel(): void {
    this.cancelled = true;
  }

  /** The first step, from the page showing now. */
  start(view: ScreenView, screenId: string): SeekStep {
    const page = this.source.read(view, screenId);
    const sig = page && this.source.signature(page);
    this.pos = sig === undefined ? -1 : this.pages.indexOf(sig);
    if (this.pos < 0 || this.cells.length === 0) return this.changed();
    return this.next(page!);
  }

  onScreen(view: ScreenView, screenId: string, refused = false): SeekStep {
    if (refused) return this.changed();
    const page = this.source.read(view, screenId);
    if (!page || this.source.signature(page) !== this.pages[this.pos]) return this.changed();
    return this.next(page);
  }

  private next(page: TablePage): SeekStep {
    if (this.cancelled) return { done: true };
    if (this.pos === this.target) {
      const field = page.options[this.index];
      if (!field) return { done: true, error: 'That row has no option field to type into.' };
      return { done: true, fields: { [field]: this.option } };
    }
    const down = this.target > this.pos;
    this.pos += down ? 1 : -1;
    return { send: down ? 'PageDown' : 'PageUp' };
  }

  private changed(): SeekStep {
    return { done: true, error: 'The list has changed since it was read. Read it again and try once more.' };
  }
}
