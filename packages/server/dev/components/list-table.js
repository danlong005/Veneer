// Veneer component: every row of a list in one table, to sort, filter and
// search, instead of a page at a time. Needs lib/lists.js beside it.
//
// Place it over the list (Page tab ▸ Components ▸ Whole-list table) and hide
// the list, its option legend and its More.../Bottom marker. When the screen
// shows, it reads the whole list the way Export does (to the top, down to the
// bottom and back to the user's page), with the same progress and Cancel.
// Options (columns are found by their heading, ignoring case):
//   columns   the columns to show, in order, e.g. ["Job", "User", "Status"];
//             default every column except the option column
//   search    false hides the search box
//   filters   columns to offer a drop-down of their values, e.g. ["Status"]
//   sort      the column to sort by at first; "-Status" sorts it descending
//   actions   which of the list's options to offer as buttons on each row, by
//             value, e.g. ["5", "2"]; default all of the legend's; [] for none
//   default   the option a click on a row (or Enter on it) runs, e.g. "5"
//   list      "all" (default) reads the whole list; "page" shows only the
//             page showing, with Previous and Next
//   maxPages  stop reading after this many pages; default 100
//   empty     what to say when no rows match; default "No rows"
//
// An option on a row pages back to that row, types the option into it and
// presses Enter, as a user would. Click a heading to sort by it (again to
// reverse). Up and Down move between rows; Home and End go to the first and
// last.

import { BASE_CSS, actionSettings, actionsOf, columnIndex, defaultAction, headingsOption, listFeed, listScope, maker, pagesOption, parseNumber, parseDate, isoDate, text, ROLES } from './lib/lists.js';

export const label = 'Whole-list table';

export const DEFAULTS = Object.freeze({ empty: 'No rows', maxPages: 100 });

/** The options, checked; `error` says what is wrong. */
export function settings(options = {}) {
  const o = options && typeof options === 'object' ? options : {};
  const s = { error: '', search: o.search !== false, empty: text(o.empty) || DEFAULTS.empty };
  s.columns = headingsOption(o, 'columns', s);
  s.filters = headingsOption(o, 'filters', s) ?? [];
  const sort = text(o.sort);
  s.sort = sort ? { column: sort.replace(/^-/, '').trim(), descending: sort.startsWith('-') } : null;
  const scope = listScope(o);
  s.list = scope.scope;
  s.error ||= scope.error;
  actionSettings(o, s);
  pagesOption(o, s, DEFAULTS.maxPages);
  return s;
}

/** Which of the list's columns to show, by index; headings that aren't there are left out. */
export function shownColumns(list, s) {
  if (!s.columns) return list.columns.map((_, k) => k);
  return s.columns.map((h) => columnIndex(list.columns, h)).filter((k) => k >= 0);
}

/**
 * How a column sorts: as numbers when every value in it that isn't blank is
 * one, as dates when every one is a date, else as text (with numbers in text
 * in order: "Item 2" before "Item 10").
 */
export function sortKind(records, k) {
  const values = records.map((r) => r.cells[k] ?? '').filter((v) => v.trim() !== '');
  if (values.length === 0) return 'text';
  if (values.every((v) => parseNumber(v) !== undefined)) return 'number';
  if (values.every((v) => parseDate(v) !== undefined)) return 'date';
  return 'text';
}

/** The records in order, by column k; blanks last either way. The sort is stable. */
export function sortRecords(records, k, descending = false) {
  const kind = sortKind(records, k);
  const key = (v) => (kind === 'number' ? parseNumber(v) : kind === 'date' ? isoDate(parseDate(v)) : v);
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return records
    .map((r, i) => ({ r, i, v: (r.cells[k] ?? '').trim() }))
    .sort((a, b) => {
      if (!a.v || !b.v) return (a.v ? 0 : 1) - (b.v ? 0 : 1) || a.i - b.i;
      const x = key(a.v);
      const y = key(b.v);
      const c = kind === 'number' ? x - y : kind === 'date' ? (x < y ? -1 : x > y ? 1 : 0) : collator.compare(x, y);
      return (descending ? -c : c) || a.i - b.i;
    })
    .map((e) => e.r);
}

/** The values of a column, for its filter: each once, in order. */
export function filterValues(records, k) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...new Set(records.map((r) => (r.cells[k] ?? '').trim()).filter(Boolean))].sort(collator.compare);
}

/**
 * The rows that match: every word of the search somewhere in the row's shown
 * cells (ignoring case), and each filter's value exactly.
 */
export function matching(records, { search = '', filters = {}, columns }) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const chosen = Object.entries(filters).filter(([, v]) => v !== '');
  return records.filter((r) => {
    if (chosen.some(([k, v]) => (r.cells[Number(k)] ?? '').trim() !== v)) return false;
    if (words.length === 0) return true;
    const hay = (columns ?? r.cells.map((_, k) => k)).map((k) => r.cells[k] ?? '').join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

const CSS = `
.vc-list-table { height: 100%; display: flex; flex-direction: column; gap: 6px; font-size: 13px; min-height: 0; }
.vc-list-table .vc-lt-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.vc-list-table .vc-lt-bar input, .vc-list-table .vc-lt-bar select { font: inherit; padding: 2px 6px; border-radius: 6px;
  border: 1px solid var(--border, #ccc); background: var(--surface, #fff); color: var(--text, inherit); }
.vc-list-table .vc-lt-bar input[type=search] { flex: 1 1 160px; min-width: 120px; }
.vc-list-table .vc-lt-count { color: var(--text-muted, #666); margin-left: auto; white-space: nowrap; }
.vc-list-table .vc-lt-scroll { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--border, #ccc); border-radius: 6px; }
.vc-list-table table { border-collapse: collapse; width: 100%; }
.vc-list-table th { position: sticky; top: 0; z-index: 1; background: var(--surface-2, #f4f4f5); text-align: left; padding: 0; font-weight: 600; }
.vc-list-table th button { all: unset; box-sizing: border-box; display: block; width: 100%; padding: 4px 8px; cursor: pointer; white-space: nowrap; }
.vc-list-table th button:focus-visible { outline: 2px solid var(--focus, var(--accent, #2563eb)); outline-offset: -2px; }
.vc-list-table th[aria-sort=ascending] button::after { content: ' ▲'; font-size: 0.75em; }
.vc-list-table th[aria-sort=descending] button::after { content: ' ▼'; font-size: 0.75em; }
.vc-list-table td { padding: 3px 8px; border-top: 1px solid var(--border, #e5e7eb); white-space: nowrap; }
.vc-list-table td.vc-lt-number { text-align: right; font-variant-numeric: tabular-nums; }
.vc-list-table tbody tr:focus-visible { outline: 2px solid var(--focus, var(--accent, #2563eb)); outline-offset: -2px; }
.vc-list-table tbody tr.vc-lt-clickable { cursor: pointer; }
.vc-list-table tbody tr:hover { background: var(--surface-2, #f4f4f5); }
.vc-list-table .vc-lt-actions { display: flex; gap: 4px; }
.vc-list-table .vc-lt-note { color: var(--text-muted, #666); }
.vc-list-table tr.vc-role-danger td { color: var(--danger, #dc2626); }
.vc-list-table tr.vc-role-warning td { color: var(--warning, #d97706); }
.vc-list-table tr.vc-role-accent td, .vc-list-table tr.vc-role-emphasis td { color: var(--accent, #2563eb); }
.vc-list-table tr.vc-role-accent2 td { color: var(--accent-2, #7c3aed); }
.vc-list-table tr.vc-role-muted td { opacity: 0.6; }
.vc-list-table .vc-lt-pager { display: flex; justify-content: flex-end; gap: 6px; }
`;

export function mount(element, ctx) {
  const doc = element.ownerDocument;
  const make = maker(doc);
  const root = make('section', 'vc-list vc-list-table');
  element.append(root);
  let current = ctx;
  let s = settings(ctx.options);
  /** What the user chose: kept across redraws and new screens. */
  const view = { search: '', filters: {}, sort: null, focused: 0 };
  let rowEls = [];

  let feed = null;
  const start = () => {
    feed?.stop();
    feed = null;
    feed = s.error ? null : listFeed(current, {
      scope: s.list,
      headings: [...(s.columns ?? []), ...s.filters, ...(s.sort ? [s.sort.column] : [])],
      maxPages: s.maxPages,
      onChange: () => draw(),
    });
  };

  const focusRow = (i) => {
    rowEls.forEach((el, k) => el.setAttribute('tabindex', k === i ? '0' : '-1'));
    rowEls[i]?.focus();
    view.focused = i;
  };

  function draw() {
    const style = make('style');
    style.textContent = BASE_CSS + CSS;
    const message = (t, ...more) => {
      const p = make('p', 'vc-list-message', t);
      p.setAttribute('role', 'status');
      p.append(...more);
      root.replaceChildren(style, p);
    };
    if (s.error) return message(`Whole-list table: ${s.error}`);
    if (!feed) return; // starting: mount draws once it has one
    const { list, loading, error } = feed.state;
    if (!list) {
      if (loading) return message('Reading the list…');
      const retry = make('button', '', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', () => feed.refresh());
      return message(error || 'No list on this screen', ...(error && !/^No list/.test(error) ? [retry] : []));
    }

    const cols = shownColumns(list, s);
    if (view.sort === null && s.sort) {
      const k = columnIndex(list.columns, s.sort.column);
      view.sort = k >= 0 ? { k, descending: s.sort.descending } : false;
    }
    const filterCols = s.filters.map((h) => columnIndex(list.columns, h)).filter((k) => k >= 0);
    const records = list.records;
    let rows = matching(records, { search: view.search, filters: view.filters, columns: cols });
    if (view.sort) rows = sortRecords(rows, view.sort.k, view.sort.descending);
    const kinds = new Map(cols.map((k) => [k, sortKind(records, k)]));
    const actions = actionsOf(list, s.actions);
    const fallback = defaultAction(list, s.default);
    const hasOptions = records.some((r) => r.option);

    // The toolbar: search, filters, the count, Refresh.
    const bar = make('div', 'vc-lt-bar');
    if (s.search) {
      const input = make('input');
      input.type = 'search';
      input.placeholder = 'Search';
      input.setAttribute('aria-label', 'Search the list');
      input.value = view.search;
      input.addEventListener('input', () => {
        view.search = input.value;
        drawBody();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation(); // Enter here searches; it isn't Enter for the host
      });
      bar.append(input);
    }
    for (const k of filterCols) {
      const select = make('select');
      select.setAttribute('aria-label', `Filter by ${list.columns[k]}`);
      select.append(new Option(`${list.columns[k]}: all`, ''));
      for (const v of filterValues(records, k)) select.append(new Option(v, v));
      select.value = view.filters[k] ?? '';
      select.addEventListener('change', () => {
        view.filters[k] = select.value;
        drawBody();
      });
      bar.append(select);
    }
    const count = make('span', 'vc-lt-count');
    count.setAttribute('role', 'status');
    bar.append(count);
    if (s.list === 'all' && !list.preview) {
      const refresh = make('button', '', loading ? 'Reading…' : 'Refresh');
      refresh.type = 'button';
      refresh.disabled = loading;
      refresh.title = 'Read the whole list again';
      refresh.addEventListener('click', () => feed.refresh());
      bar.append(refresh);
    }

    const scroll = make('div', 'vc-lt-scroll');
    const table = make('table');
    const head = make('thead');
    const tr = make('tr');
    for (const k of cols) {
      const th = make('th');
      th.scope = 'col';
      if (view.sort && view.sort.k === k) th.setAttribute('aria-sort', view.sort.descending ? 'descending' : 'ascending');
      const b = make('button', '', list.columns[k] || ' ');
      b.type = 'button';
      b.title = `Sort by ${list.columns[k]}`;
      b.addEventListener('click', () => {
        view.sort = view.sort && view.sort.k === k ? { k, descending: !view.sort.descending } : { k, descending: false };
        draw();
        root.querySelector(`th[data-k="${k}"] button`)?.focus();
      });
      th.dataset.k = String(k);
      th.append(b);
      tr.append(th);
    }
    if (hasOptions && actions.length) tr.append(make('th', '', ''));
    head.append(tr);
    const body = make('tbody');
    table.append(head, body);
    scroll.append(table);

    const parts = [style, bar, scroll];
    if (!list.complete && !list.preview && s.list === 'all') {
      parts.push(make('p', 'vc-lt-note', `Stopped after ${list.pages} pages; the rest of the list isn't shown. Search on the host to narrow it.`));
    }
    if (list.preview) parts.push(make('p', 'vc-lt-note', 'In the designer only the page showing is read.'));
    if (s.list === 'page') {
      const pager = make('nav', 'vc-lt-pager');
      pager.setAttribute('aria-label', 'Pages');
      const prev = make('button', '', 'Previous');
      prev.type = 'button';
      prev.addEventListener('click', () => { if (!current.design) current.press('PageUp'); });
      pager.append(prev);
      if (list.more) {
        const next = make('button', '', 'Next');
        next.type = 'button';
        next.addEventListener('click', () => { if (!current.design) current.press('PageDown'); });
        pager.append(next);
      }
      parts.push(pager);
    }
    root.replaceChildren(...parts);
    drawBody();

    function drawBody() {
      rows = matching(records, { search: view.search, filters: view.filters, columns: cols });
      if (view.sort) rows = sortRecords(rows, view.sort.k, view.sort.descending);
      count.textContent = rows.length === records.length ? `${records.length} rows` : `${rows.length} of ${records.length} rows`;
      rowEls = [];
      body.replaceChildren();
      if (rows.length === 0) {
        const empty = make('tr');
        const td = make('td', 'vc-lt-note', s.empty);
        td.colSpan = cols.length + (hasOptions && actions.length ? 1 : 0);
        empty.append(td);
        body.append(empty);
        return;
      }
      const first = Math.min(view.focused, rows.length - 1);
      rows.forEach((r, i) => {
        const canRun = !!(fallback && r.option);
        const row = make('tr', [ROLES.has(r.role) && `vc-role-${r.role}`, canRun && 'vc-lt-clickable'].filter(Boolean).join(' '));
        row.setAttribute('tabindex', i === first ? '0' : '-1');
        if (canRun) {
          row.title = fallback.label;
          row.addEventListener('click', () => feed.run(r, fallback.value));
        }
        row.addEventListener('keydown', (e) => {
          if (e.target !== row) return;
          const move = { ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity, PageDown: 10, PageUp: -10 }[e.key];
          if (move !== undefined) {
            e.preventDefault();
            e.stopPropagation(); // Page Up and Down move in the table, not the host's list
            focusRow(Math.min(Math.max(i + move, 0), rows.length - 1));
          } else if (e.key === 'Enter' && canRun) {
            e.preventDefault();
            e.stopPropagation();
            feed.run(r, fallback.value);
          }
        });
        row.addEventListener('focus', () => { view.focused = i; });
        for (const k of cols) row.append(make('td', kinds.get(k) === 'number' ? 'vc-lt-number' : '', r.cells[k] ?? ''));
        if (hasOptions && actions.length) {
          const td = make('td');
          if (r.option) {
            const wrap = make('div', 'vc-lt-actions');
            for (const a of actions) {
              const b = make('button', '', a.label);
              b.type = 'button';
              b.dataset.option = a.value;
              b.setAttribute('aria-label', `${a.label} ${r.cells[cols[0]] ?? ''}`.trim());
              b.addEventListener('click', (e) => {
                e.stopPropagation();
                feed.run(r, a.value);
              });
              wrap.append(b);
            }
            td.append(wrap);
          }
          row.append(td);
        }
        rowEls.push(row);
        body.append(row);
      });
    }
  }

  start();
  draw();
  return {
    update(next) {
      current = next;
      const again = settings(next.options);
      if (JSON.stringify(again) !== JSON.stringify(s)) {
        // New options (in the designer): start over with them.
        s = again;
        view.sort = null;
        start();
        draw();
      } else if (feed) feed.update(next);
    },
    unmount() {
      feed?.stop();
      root.remove();
    },
  };
}
