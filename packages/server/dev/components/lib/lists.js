// Shared by the ready-made components that show a list: the whole-list table,
// totals, board, calendar, tree and pin map. Not a component itself (it is in
// lib/, so Veneer doesn't list it); copy the lib folder along with them.
//
// A list comes from one of two places, by the component's "list" option:
//   "page"  the page of the list showing now (ctx.tables); paging redraws it
//   "all"   the whole list, read with ctx.readList(), which pages to the top,
//           down to the bottom and back as Export does
// Either way the component gets the same shape: { columns, records, options,
// complete, ... } with the option column (where users type 2=Change) left out.

/** Same heading, ignoring case and spaces at the ends. */
export const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** A trimmed string option, or ''. */
export const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** Roles a style rule can give a row or cell that components show. */
export const ROLES = new Set(['emphasis', 'muted', 'danger', 'warning', 'accent', 'accent2']);

/**
 * A number as a host screen shows it: "1,234.50", "12.50-", "-12,50",
 * "$1,200", "45%", "12.5CR", "(12.00)". With both "." and ",", the last is
 * the decimal point; with one, it is a thousands separator when it is used
 * more than once or three digits follow it. { value, decimals } (decimals: how
 * many it shows), or undefined when it isn't a number.
 */
export function readNumber(input) {
  let s = String(input ?? '').trim().toUpperCase().replace(/\s+/g, '');
  const negative = /^-|-$|CR$|^\(.*\)$/.test(s);
  s = s.replace(/^\((.*)\)$/, '$1').replace(/^[-+]|[-+]$|CR$/g, '').replace(/^[$€£¥]|[$€£¥%]$/g, '');
  if (!/^[\d.,]*\d[\d.,]*$/.test(s)) return undefined;
  const seps = s.match(/[.,]/g) ?? [];
  const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  const decimal = seps.length > 0 && (new Set(seps).size > 1 || (seps.length === 1 && s.length - last - 1 !== 3));
  const n = Number(decimal ? `${s.slice(0, last).replace(/[.,]/g, '')}.${s.slice(last + 1)}` : s.replace(/[.,]/g, ''));
  if (!Number.isFinite(n)) return undefined;
  return { value: negative && n !== 0 ? -n : n, decimals: decimal ? s.length - last - 1 : 0 };
}

/** readNumber's value alone. */
export const parseNumber = (input) => readNumber(input)?.value;

/** The column with this heading, or -1. */
export const columnIndex = (columns, heading) => (heading ? columns.findIndex((c) => same(c, heading)) : -1);

/** "list": "all" or "page" (the default given), or an error. */
export function listScope(options, fallback = 'all') {
  const v = options?.list === undefined ? fallback : String(options.list).trim().toLowerCase();
  return v === 'all' || v === 'page' ? { scope: v, error: '' } : { scope: fallback, error: '"list" must be "all" or "page"' };
}

/** The option column of a list on the screen, or -1. */
function optionColumn(table) {
  for (const r of table.records ?? []) {
    if (r.option) {
      const k = r.fields.indexOf(r.option);
      if (k >= 0) return k;
    }
  }
  return -1;
}

/**
 * The page showing, in readList()'s shape: the option column left out, each
 * record keeping its option field so an option can be typed into it.
 */
export function pageList(table) {
  const opt = optionColumn(table);
  const keep = (cells) => cells.filter((_, k) => k !== opt);
  const records = (table.records ?? table.rows.map((cells) => ({ cells, fields: [], option: null, role: null, roles: [] })))
    .map((r, index) => ({ cells: keep(r.cells), raw: keep(r.raw ?? r.cells), role: r.role ?? null, roles: keep(r.roles ?? []), option: r.option ?? null, page: 0, index }));
  return {
    row: table.row, col: table.col,
    columns: keep(table.columns),
    rows: records.map((r) => r.cells),
    records,
    options: table.options ?? [],
    pages: 1, current: 0, pageKeys: [table.pageKey], complete: !table.more,
    more: table.more,
  };
}

/** The list a component shows: the first on the screen that has every heading named, else the first. */
export function pickTable(tables, headings = []) {
  const named = headings.filter(Boolean);
  const has = (t) => named.every((h) => t.columns.some((c) => same(c, h)));
  return (tables ?? []).find(has) ?? (named.length === 0 ? tables?.[0] : undefined);
}

/** Reads that fail one after another before a component waits for Refresh. */
export const MAX_RETRIES = 2;

/**
 * Keeps a component's list: the page showing, or the whole list. `onChange`
 * is called with { list, loading, error } whenever that changes. The whole
 * list is read when the component mounts, and again when the page showing is
 * none of the pages read (the list changed: a row was added or deleted).
 */
export function listFeed(ctx, { scope, headings = [], maxPages, onChange }) {
  let current = ctx;
  let state = { list: null, loading: false, error: '' };
  let reading = false;
  let gone = false;
  /**
   * The screen a read failed on, and how many failed in a row: a new screen
   * (the user pressed Enter, say) tries again, but not more than twice in a
   * row, so a list that keeps changing doesn't page forever.
   */
  let failedOn = null;
  let failures = 0;

  const set = (next) => {
    state = { ...state, ...next };
    if (!gone) onChange(state);
  };
  const table = () => pickTable(current.tables, headings);

  const read = (force = false) => {
    const t = table();
    if (!t) return set({ list: null, loading: false, error: headings.length ? `No list on this screen has the columns ${headings.map((h) => `“${h}”`).join(', ')}` : 'No list on this screen' });
    if (scope === 'page' || current.design) {
      const page = pageList(t);
      return set({ list: scope === 'page' ? page : { ...page, preview: true }, loading: false, error: '' });
    }
    if (reading) return;
    if (!force && state.list && state.list.row === t.row && state.list.col === t.col && state.list.pageKeys.includes(t.pageKey)) return;
    if (!force && failedOn && (failedOn === current.screen || failures >= MAX_RETRIES)) return;
    reading = true;
    set({ loading: true, error: '' });
    current.readList({ at: { row: t.row, col: t.col }, ...(maxPages ? { maxPages } : {}) }).then(
      (list) => { reading = false; failedOn = null; failures = 0; set({ list, loading: false, error: '' }); },
      (err) => { reading = false; failedOn = current.screen ?? true; failures++; set({ loading: false, error: err?.message ?? String(err) }); },
    );
  };

  read();
  return {
    get state() { return state; },
    /** A new ctx (a new screen, or typing): the page showing may have changed. */
    update(next) {
      current = next;
      // While reading, the screens are the reader's pages, not the user's.
      if (!reading) read();
    },
    /** Read the whole list again (a Refresh button). */
    refresh() {
      failedOn = null;
      failures = 0;
      read(true);
    },
    /**
     * Run a list option on a record: types it into the row's option field
     * and presses Enter, after paging to the row if it isn't showing.
     */
    run(record, value) {
      if (!value || current.design) return false;
      if (scope === 'page' || state.list?.preview) {
        if (!record.option) return false;
        current.press('Enter', { [record.option]: value });
        return true;
      }
      current.openRow(record, value).catch(() => { /* the app says why */ });
      return true;
    },
    stop() { gone = true; },
  };
}

/** A small DOM helper: el('p', 'class', 'text'). */
export function maker(doc) {
  return (tag, className, content) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  };
}

/** The list's options a component offers as buttons: the legend's, or those `actions` names, in that order. */
export function actionsOf(list, actions) {
  const legend = list.options ?? [];
  if (!actions) return legend.map((o) => ({ value: o.value, label: o.label }));
  return actions.map((v) => legend.find((o) => o.value === v) ?? { value: v, label: `Option ${v}` });
}

/** "actions" and "default" options: which list options to offer, and the one a click runs. */
export function actionSettings(o, s) {
  if (o.actions !== undefined) {
    if (!Array.isArray(o.actions) || o.actions.some((a) => typeof a !== 'string' && typeof a !== 'number')) {
      s.error ||= '"actions" must be a list of option values, such as ["5", "2"]';
    } else s.actions = o.actions.map((a) => String(a).trim()).filter(Boolean);
  } else s.actions = null;
  s.default = o.default === undefined || o.default === null ? '' : String(o.default).trim();
  return s;
}

/** The default option, with its label from the legend. */
export function defaultAction(list, value) {
  if (!value) return null;
  return (list.options ?? []).find((o) => o.value === value) ?? { value, label: `Option ${value}` };
}

/** "maxPages": a whole number of pages, 1 to 500. */
export function pagesOption(o, s, fallback = 100) {
  if (o.maxPages === undefined) return (s.maxPages = fallback);
  const n = Math.round(Number(o.maxPages));
  if (Number.isFinite(n) && n >= 1) s.maxPages = Math.min(n, 500);
  else { s.maxPages = fallback; s.error ||= '"maxPages" must be a number of pages'; }
  return s.maxPages;
}

/** A list of column headings option, or null when it isn't given. */
export function headingsOption(o, name, s) {
  const v = o[name];
  if (v === undefined) return null;
  if (!Array.isArray(v) || v.some((h) => typeof h !== 'string')) {
    s.error ||= `"${name}" must be a list of column headings`;
    return null;
  }
  return v.map((h) => h.trim()).filter(Boolean);
}

/**
 * A date as hosts show them, by `format` ("MM/DD/YY", "YYYY-MM-DD",
 * "CYYMMDD", "YYMMDD", "DD.MM.YYYY"…; separators must match), or, with no
 * format, ISO, "MM/DD/YYYY" or "MM/DD/YY". { y, m, d } or undefined.
 * YY is 1940-2039; C (IBM's century digit) is 0 for 19xx and 1 for 20xx.
 */
export function parseDate(value, format = '') {
  const t = String(value ?? '').trim();
  if (!t) return undefined;
  const f = String(format).toUpperCase();
  let y, m, d;
  if (f) {
    if (t.length !== f.length) return undefined;
    const take = (ch) => { let out = ''; for (let i = 0; i < f.length; i++) if (f[i] === ch) out += t[i]; return out; };
    for (let i = 0; i < f.length; i++) {
      if (!'CYMD'.includes(f[i]) && f[i] !== t[i]) return undefined;
      if ('CYMD'.includes(f[i]) && !/\d/.test(t[i])) return undefined;
    }
    const yy = take('Y');
    const c = take('C');
    y = Number(yy);
    if (yy.length === 2) y += c ? 1900 + 100 * Number(c) : y < 40 ? 2000 : 1900;
    m = Number(take('M'));
    d = Number(take('D'));
  } else {
    let mm;
    if ((mm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) [y, m, d] = [Number(mm[1]), Number(mm[2]), Number(mm[3])];
    else if ((mm = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t))) {
      [m, d, y] = [Number(mm[1]), Number(mm[2]), Number(mm[3])];
      if (mm[3].length === 2) y += y < 40 ? 2000 : 1900;
    } else return undefined;
  }
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1)) return undefined;
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCMonth() !== m - 1) return undefined;
  return { y, m, d };
}

/** "2026-11-05" for a parsed date: sorts and compares as text. */
export const isoDate = ({ y, m, d }) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Shared look for messages and buttons; each component adds its own. */
export const BASE_CSS = `
.vc-list-message { margin: auto; padding: 8px; color: var(--text-muted, #666); text-align: center; }
.vc-list-message button { margin-left: 6px; }
.vc-list button { font: inherit; font-size: 0.9em; padding: 2px 8px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--border, #ccc); background: var(--surface-2, #f4f4f5); color: var(--text, inherit); }
.vc-list button:hover:not(:disabled) { border-color: var(--accent, #2563eb); }
.vc-list button:disabled { opacity: 0.5; cursor: default; }
.vc-list :focus-visible { outline: 2px solid var(--focus, var(--accent, #2563eb)); outline-offset: 1px; }
`;
