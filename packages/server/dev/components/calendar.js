// Veneer component: a list's rows on a month or week calendar, by a date
// column. Needs lib/lists.js beside it.
//
// Place it over the list (Page tab ▸ Components ▸ Calendar) and hide the
// list, its option legend and its More.../Bottom marker. Options (columns are
// found by their heading, ignoring case):
//   date       the column with each row's date, e.g. "Ship date" (required)
//   format     how the host writes the date: "MM/DD/YY", "YYYY-MM-DD",
//              "CYYMMDD", "YYMMDD", "DD.MM.YYYY" and so on (Y year, M month,
//              D day, C IBM's century digit; other characters must match).
//              Default: ISO (2026-11-05), MM/DD/YYYY or MM/DD/YY
//   title      the column naming each entry; default the first other column
//   view       "month" (default) or "week"
//   weekStart  0 for Sunday (default), 1 for Monday
//   default    the list option a click on an entry runs, e.g. "5"
//   list       "all" (default) reads the whole list, as Export does; "page"
//              shows the page showing
//   maxPages   stop reading after this many pages; default 100
//
// It opens on the month (or week) of today if anything falls in it, else of
// the first date in the list. Rows whose date can't be read are counted
// below the calendar. Click a day (or press Enter on it) to list its entries
// below; click an entry to run the default option on its row. Arrow keys move
// a day (Up and Down a week); Page Up and Page Down move a month or a week.

import { BASE_CSS, ROLES, columnIndex, defaultAction, isoDate, listFeed, listScope, maker, pagesOption, parseDate, text } from './lib/lists.js';

export const label = 'Calendar';

/** The options, checked; `error` says what is wrong. */
export function settings(options = {}) {
  const o = options && typeof options === 'object' ? options : {};
  const s = { date: text(o.date), format: text(o.format), title: text(o.title), error: '' };
  s.view = o.view === undefined ? 'month' : String(o.view).trim().toLowerCase();
  s.weekStart = o.weekStart === undefined ? 0 : Number(o.weekStart);
  s.default = o.default === undefined || o.default === null ? '' : String(o.default).trim();
  const scope = listScope(o);
  s.list = scope.scope;
  s.error = scope.error;
  pagesOption(o, s);
  if (!s.date) s.error ||= 'Set the "date" option to the heading of the date column, e.g. "Ship date"';
  if (s.view !== 'month' && s.view !== 'week') s.error ||= '"view" must be "month" or "week"';
  if (s.weekStart !== 0 && s.weekStart !== 1) s.error ||= '"weekStart" must be 0 (Sunday) or 1 (Monday)';
  if (s.format && !/^[CYMD./\-: ]+$/i.test(s.format)) s.error ||= `"format" "${s.format}" isn't a date format: use Y, M, D and C, with separators such as / - .`;
  if (s.format && !(/Y/i.test(s.format) && /M/i.test(s.format) && /D/i.test(s.format))) s.error ||= '"format" needs Y, M and D, e.g. "MM/DD/YY"';
  return s;
}

/** Each row with a date it can read: { iso, title, record }; and how many it couldn't. */
export function eventsOf(list, s) {
  const k = columnIndex(list.columns, s.date);
  if (k < 0) return { error: `No “${s.date}” column in the list` };
  const t = s.title ? columnIndex(list.columns, s.title) : list.columns.findIndex((_, i) => i !== k);
  if (s.title && t < 0) return { error: `No “${s.title}” column in the list` };
  const events = [];
  let unread = 0;
  for (const r of list.records) {
    const raw = (r.cells[k] ?? '').trim();
    const d = parseDate(raw, s.format);
    if (!d) {
      if (raw && !/^0+$/.test(raw.replace(/\D/g, ''))) unread++;
      continue;
    }
    events.push({ iso: isoDate(d), title: (r.cells[t] ?? '').trim(), record: r });
  }
  return { events, unread };
}

const pad = (n) => String(n).padStart(2, '0');
const utc = (iso) => new Date(`${iso}T00:00:00Z`);
const toIso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
/** The date `days` after an ISO date. */
export const addDays = (iso, days) => toIso(new Date(utc(iso).getTime() + days * 86400000));
/** The same day `months` later, or the month's last day if it has fewer. */
export function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return toIso(first);
}
/** The first day of the week holding `iso`. */
export const weekOf = (iso, weekStart = 0) => addDays(iso, -((utc(iso).getUTCDay() - weekStart + 7) % 7));

/** The weeks shown for the month holding `iso`: 7 days each, from the week the 1st is in. */
export function monthGrid(iso, weekStart = 0) {
  const month = iso.slice(0, 7);
  let day = weekOf(`${month}-01`, weekStart);
  const weeks = [];
  do {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push({ iso: day, inMonth: day.slice(0, 7) === month });
      day = addDays(day, 1);
    }
    weeks.push(week);
  } while (day.slice(0, 7) === month);
  return weeks;
}

/** Where to open: today if anything is in today's month (or week), else the first date there is. */
export function openingDay(events, todayIso, view = 'month', weekStart = 0) {
  const span = (iso) => (view === 'week' ? weekOf(iso, weekStart) : iso.slice(0, 7));
  if (events.length === 0 || events.some((e) => span(e.iso) === span(todayIso))) return todayIso;
  return [...events].sort((a, b) => (a.iso < b.iso ? -1 : 1))[0].iso;
}

const CSS = `
.vc-calendar { height: 100%; display: flex; flex-direction: column; gap: 6px; font-size: 12px; min-height: 0; }
.vc-calendar .vc-cal-bar { display: flex; align-items: center; gap: 6px; }
.vc-calendar .vc-cal-bar h3 { margin: 0 auto 0 4px; font-size: 1.1em; font-weight: 650; }
.vc-calendar .vc-cal-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); grid-template-rows: auto; grid-auto-rows: minmax(2.4em, 1fr);
  border-top: 1px solid var(--border, #e5e7eb); border-left: 1px solid var(--border, #e5e7eb); overflow: auto; }
.vc-calendar .vc-cal-dow { font-weight: 600; color: var(--text-muted, #666); padding: 2px 4px; border-right: 1px solid var(--border, #e5e7eb);
  border-bottom: 1px solid var(--border, #e5e7eb); background: var(--surface-2, #f4f4f5); }
.vc-calendar .vc-cal-day { min-height: 0; overflow: hidden; padding: 2px 4px; border-right: 1px solid var(--border, #e5e7eb);
  border-bottom: 1px solid var(--border, #e5e7eb); display: flex; flex-direction: column; gap: 2px; cursor: pointer; background: var(--surface, #fff); }
.vc-calendar .vc-cal-day.vc-cal-out { background: var(--surface-2, #f8f9fb); color: var(--text-muted, #888); }
.vc-calendar .vc-cal-day.vc-cal-selected { box-shadow: inset 0 0 0 2px var(--accent, #2563eb); }
.vc-calendar .vc-cal-top { display: flex; align-items: center; gap: 4px; }
.vc-calendar .vc-cal-num { font-variant-numeric: tabular-nums; min-width: 1.6em; text-align: center; border-radius: 999px; }
.vc-calendar .vc-cal-today .vc-cal-num { background: var(--accent, #2563eb); color: #fff; }
.vc-calendar .vc-cal-count { margin-left: auto; padding: 0 5px; border-radius: 999px; font-size: 0.9em; font-variant-numeric: tabular-nums;
  background: var(--accent-soft, #e8efff); color: var(--text, inherit); }
.vc-calendar .vc-cal-entry { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 4px; border-radius: 4px;
  background: var(--accent-soft, #e8efff); border-left: 3px solid var(--accent, #2563eb); }
.vc-calendar .vc-cal-entry.vc-role-danger { border-left-color: var(--danger, #dc2626); }
.vc-calendar .vc-cal-entry.vc-role-warning { border-left-color: var(--warning, #d97706); }
.vc-calendar .vc-cal-more { color: var(--text-muted, #666); }
.vc-calendar .vc-cal-list { max-height: 35%; overflow: auto; margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
.vc-calendar .vc-cal-list h4 { margin: 0 0 2px; font-size: 1em; }
.vc-calendar .vc-cal-list button { text-align: left; }
.vc-calendar .vc-cal-note { margin: 0; color: var(--text-muted, #666); }
`;

export function mount(element, ctx) {
  const doc = element.ownerDocument;
  const make = maker(doc);
  const root = make('section', 'vc-list vc-calendar');
  element.append(root);
  let current = ctx;
  let s = settings(ctx.options);
  let feed = null;
  /** The day the calendar is on, and the one picked; null until the list arrives. */
  let focusDay = null;
  let picked = null;

  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const locale = () => doc.documentElement.lang || undefined;
  const longDate = (iso, opts) => new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', ...opts }).format(utc(iso));

  const start = () => {
    feed?.stop();
    feed = null;
    focusDay = null;
    feed = s.error ? null : listFeed(current, { scope: s.list, headings: [s.date, s.title].filter(Boolean), maxPages: s.maxPages, onChange: () => draw() });
  };

  const button = (label, onClick, title) => {
    const b = make('button', '', label);
    b.type = 'button';
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  };

  function draw(focus = false) {
    const style = make('style');
    style.textContent = BASE_CSS + CSS;
    const message = (t) => {
      const p = make('p', 'vc-list-message', t);
      p.setAttribute('role', 'status');
      root.replaceChildren(style, p);
    };
    if (s.error) return message(`Calendar: ${s.error}`);
    if (!feed) return;
    const { list, loading, error } = feed.state;
    if (!list) return message(loading ? 'Reading the list…' : error || 'No list on this screen');
    const found = eventsOf(list, s);
    if (found.error) return message(found.error);
    const { events, unread } = found;
    focusDay ??= openingDay(events, today, s.view, s.weekStart);
    const byDay = new Map();
    for (const e of events) byDay.set(e.iso, [...(byDay.get(e.iso) ?? []), e]);
    const fallback = defaultAction(list, s.default);
    const run = (e) => { if (fallback && e.record.option) feed.run(e.record, fallback.value); };

    const weeks = s.view === 'week'
      ? [Array.from({ length: 7 }, (_, i) => { const iso = addDays(weekOf(focusDay, s.weekStart), i); return { iso, inMonth: true }; })]
      : monthGrid(focusDay, s.weekStart);
    const move = (days, months = 0) => {
      focusDay = months ? addMonths(focusDay, months) : addDays(focusDay, days);
      draw(true);
    };
    const step = s.view === 'week' ? () => move(-7) : () => move(0, -1);
    const stepOn = s.view === 'week' ? () => move(7) : () => move(0, 1);

    const bar = make('div', 'vc-cal-bar');
    const heading = make('h3', '', s.view === 'week'
      ? `${longDate(weeks[0][0].iso, { month: 'short', day: 'numeric' })} – ${longDate(weeks[0][6].iso, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : longDate(focusDay, { month: 'long', year: 'numeric' }));
    heading.setAttribute('aria-live', 'polite');
    bar.append(heading,
      button('‹', step, s.view === 'week' ? 'Previous week' : 'Previous month'),
      button('Today', () => { focusDay = today; draw(true); }),
      button('›', stepOn, s.view === 'week' ? 'Next week' : 'Next month'));
    bar.children[1].setAttribute('aria-label', bar.children[1].title);
    bar.children[3].setAttribute('aria-label', bar.children[3].title);

    const grid = make('div', 'vc-cal-grid');
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', heading.textContent);
    const head = make('div');
    head.setAttribute('role', 'row');
    head.style.display = 'contents';
    for (const d of weeks[0]) {
      const dow = make('div', 'vc-cal-dow', longDate(d.iso, { weekday: 'short' }));
      dow.setAttribute('role', 'columnheader');
      head.append(dow);
    }
    grid.append(head);
    const perDay = s.view === 'week' ? 50 : 3;
    for (const week of weeks) {
      const row = make('div');
      row.setAttribute('role', 'row');
      row.style.display = 'contents';
      for (const d of week) {
        const items = byDay.get(d.iso) ?? [];
        const cell = make('div', ['vc-cal-day', !d.inMonth && 'vc-cal-out', d.iso === today && 'vc-cal-today', d.iso === picked && 'vc-cal-selected'].filter(Boolean).join(' '));
        cell.setAttribute('role', 'gridcell');
        cell.dataset.day = d.iso;
        cell.setAttribute('tabindex', d.iso === focusDay ? '0' : '-1');
        cell.setAttribute('aria-selected', String(d.iso === picked));
        cell.setAttribute('aria-label', `${longDate(d.iso, { weekday: 'long', month: 'long', day: 'numeric' })}: ${items.length ? `${items.length} ${items.length === 1 ? 'entry' : 'entries'}` : 'nothing'}`);
        // The count shows even when the day is too small for its entries.
        const top = make('div', 'vc-cal-top');
        top.append(make('span', 'vc-cal-num', String(Number(d.iso.slice(8)))));
        if (items.length) {
          const count = make('span', 'vc-cal-count', String(items.length));
          count.setAttribute('aria-hidden', 'true');
          top.append(count);
        }
        cell.append(top);
        for (const e of items.slice(0, perDay)) {
          const entry = make('div', `vc-cal-entry${ROLES.has(e.record.role) ? ` vc-role-${e.record.role}` : ''}`, e.title || '—');
          entry.title = e.title;
          cell.append(entry);
        }
        if (items.length > perDay) cell.append(make('span', 'vc-cal-more', `+${items.length - perDay} more`));
        const pick = () => {
          picked = d.iso;
          focusDay = d.iso;
          draw(true);
        };
        cell.addEventListener('click', pick);
        cell.addEventListener('keydown', (e) => {
          const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
          if (by !== undefined) { e.preventDefault(); move(by); return; }
          if (e.key === 'PageUp' || e.key === 'PageDown') {
            e.preventDefault();
            e.stopPropagation(); // not the host's list
            (e.key === 'PageUp' ? step : stepOn)();
            return;
          }
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation(); // not Enter for the host
            pick();
          }
        });
        row.append(cell);
      }
      grid.append(row);
    }

    const parts = [style, bar, grid];
    if (picked) {
      const items = byDay.get(picked) ?? [];
      const ul = make('ul', 'vc-cal-list');
      ul.setAttribute('aria-label', longDate(picked, { weekday: 'long', month: 'long', day: 'numeric' }));
      const h = make('h4', '', `${longDate(picked, { weekday: 'long', month: 'long', day: 'numeric' })}: ${items.length || 'nothing'}`);
      ul.append(h);
      for (const e of items) {
        const li = make('li');
        if (fallback && e.record.option) {
          const b = button(e.title || '—', () => run(e), `${fallback.label} ${e.title}`.trim());
          li.append(b);
        } else li.textContent = e.title || '—';
        ul.append(li);
      }
      parts.push(ul);
    }
    const notes = [];
    if (unread) notes.push(`${unread} ${unread === 1 ? 'row has a date' : 'rows have dates'} that couldn't be read${s.format ? ` as ${s.format}` : '; set "format"'}.`);
    if (list.preview) notes.push('In the designer only the page showing is read.');
    else if (s.list === 'all' && !list.complete) notes.push(`Stopped after ${list.pages} pages.`);
    else if (s.list === 'page' && list.more) notes.push('This page of the list only.');
    if (notes.length) parts.push(make('p', 'vc-cal-note', notes.join(' ')));
    root.replaceChildren(...parts);
    if (focus) root.querySelector(`[data-day="${focusDay}"]`)?.focus();
  }

  start();
  draw();
  return {
    update(next) {
      current = next;
      const again = settings(next.options);
      if (JSON.stringify(again) !== JSON.stringify(s)) {
        s = again;
        start();
        draw();
      } else feed?.update(next);
    },
    unmount() {
      feed?.stop();
      root.remove();
    },
  };
}
