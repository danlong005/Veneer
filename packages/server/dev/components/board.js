// Veneer component: a list as a board, its rows as cards in a column per
// status (Open / Held / Shipped). Needs cards.js and lib/lists.js beside it.
//
// Place it over the list (Page tab ▸ Components ▸ Board) and hide the list,
// its option legend and its More.../Bottom marker. Options (columns are found
// by their heading, ignoring case):
//   column    the column to group by, e.g. "Status" (required)
//   lanes     the board's columns, in order: values, e.g. ["OPEN", "HELD",
//             "SHIPPED"], or { "value": "HLD", "label": "Held" }; rows with
//             another value go in a last "Other" lane. Default: each value
//             in the order it first appears
//   list      "all" (default) reads the whole list, as Export does; "page"
//             shows the page showing
//   maxPages  stop reading after this many pages; default 100
//   title, subtitle, fields, actions, default, width: as for cards.js (the
//             title, the line under it, the facts on each card, the list
//             options offered as buttons, the one a click on a card runs, and
//             the narrowest a lane gets, in pixels)
//
// An option on a card pages back to its row, types the option into it and
// presses Enter, as a user would. Arrow keys move between cards: Left and
// Right to the next lane, Up and Down within one.

import { cardsOf, settings as cardSettings } from './cards.js';
import { BASE_CSS, ROLES, actionsOf, columnIndex, defaultAction, listFeed, listScope, maker, pagesOption, same, text } from './lib/lists.js';

export const label = 'Board';

/** The options, checked; `error` says what is wrong. */
export function settings(options = {}) {
  const o = options && typeof options === 'object' ? options : {};
  const card = cardSettings(o);
  const s = { ...card, column: text(o.column), lanes: null };
  const scope = listScope(o);
  s.list = scope.scope;
  s.error ||= scope.error;
  pagesOption(o, s);
  if (!s.column) s.error ||= 'Set the "column" option to the heading of the column to group by, e.g. "Status"';
  if (o.lanes !== undefined) {
    const ok = Array.isArray(o.lanes) && o.lanes.every((l) => typeof l === 'string' || (l && typeof l === 'object' && typeof l.value === 'string'));
    if (!ok) s.error ||= '"lanes" must be a list of values, such as ["OPEN", "HELD"], or { "value", "label" }';
    else s.lanes = o.lanes.map((l) => (typeof l === 'string' ? { value: l.trim(), label: l.trim() } : { value: l.value.trim(), label: text(l.label) || l.value.trim() }));
  }
  return s;
}

/**
 * The lanes and the cards in each: the lanes named (in order, even when
 * empty), then any other values in an "Other" lane; with no lanes named, one
 * per value in the order they first appear. Values match ignoring case.
 */
export function lanesOf(list, s) {
  const k = columnIndex(list.columns, s.column);
  if (k < 0) return { error: `No “${s.column}” column in the list` };
  const cards = cardsOf({ ...list, records: list.records }, s);
  const lanes = (s.lanes ?? []).map((l) => ({ ...l, cards: [] }));
  const other = { value: '', label: 'Other', cards: [], other: true };
  for (const c of cards) {
    const v = (c.record.cells[k] ?? '').trim();
    let lane = lanes.find((l) => same(l.value, v));
    if (!lane && !s.lanes) {
      lane = { value: v, label: v || '(blank)', cards: [] };
      lanes.push(lane);
    }
    (lane ?? other).cards.push(c);
  }
  if (other.cards.length) lanes.push(other);
  return { lanes };
}

const CSS = `
.vc-board { height: 100%; display: flex; flex-direction: column; gap: 6px; font-size: 13px; min-height: 0; }
.vc-board .vc-board-lanes { flex: 1; min-height: 0; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(var(--vc-lane-width), 1fr);
  gap: 8px; overflow-x: auto; }
.vc-board .vc-lane { display: flex; flex-direction: column; min-height: 0; border-radius: 8px; background: var(--surface-2, #f4f4f5); }
.vc-board .vc-lane h3 { margin: 0; padding: 6px 10px; font-size: 0.95em; font-weight: 650; display: flex; justify-content: space-between; gap: 6px; }
.vc-board .vc-lane h3 span { color: var(--text-muted, #666); font-weight: normal; }
.vc-board .vc-lane ul { flex: 1; min-height: 0; overflow-y: auto; margin: 0; padding: 0 6px 6px; list-style: none; display: flex; flex-direction: column; gap: 6px; }
.vc-board .vc-card { display: flex; flex-direction: column; gap: 3px; padding: 6px 8px; border: 1px solid var(--border, #ccc);
  border-left: 4px solid var(--border, #ccc); border-radius: 6px; background: var(--surface, #fff); }
.vc-board .vc-card.vc-card-clickable { cursor: pointer; }
.vc-board .vc-card.vc-card-clickable:hover { border-color: var(--accent, #2563eb); }
.vc-board .vc-card h4 { margin: 0; font-size: 1em; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vc-board .vc-card p { margin: 0; color: var(--text-muted, #666); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vc-board .vc-card dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 0 6px; font-size: 0.92em; }
.vc-board .vc-card dt { color: var(--text-muted, #666); }
.vc-board .vc-card dd { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vc-board .vc-card-actions { display: flex; flex-wrap: wrap; gap: 4px; padding-top: 2px; }
.vc-board .vc-lane-empty { color: var(--text-muted, #666); padding: 4px; font-style: italic; }
.vc-board .vc-board-note { margin: 0; color: var(--text-muted, #666); }
.vc-board .vc-role-danger { border-left-color: var(--danger, #dc2626); }
.vc-board .vc-role-warning { border-left-color: var(--warning, #d97706); }
.vc-board .vc-role-accent, .vc-board .vc-role-emphasis { border-left-color: var(--accent, #2563eb); }
.vc-board .vc-role-accent2 { border-left-color: var(--accent-2, #7c3aed); }
.vc-board .vc-card.vc-role-muted { opacity: 0.6; }
`;

export function mount(element, ctx) {
  const doc = element.ownerDocument;
  const make = maker(doc);
  const root = make('section', 'vc-list vc-board');
  element.append(root);
  let current = ctx;
  let s = settings(ctx.options);
  let feed = null;
  /** The cards drawn, by lane: for the arrow keys. */
  let grid = [];

  const start = () => {
    feed?.stop();
    feed = null;
    const headings = [s.column, s.title, s.subtitle, ...(s.fields ?? [])].filter(Boolean);
    feed = s.error ? null : listFeed(current, { scope: s.list, headings, maxPages: s.maxPages, onChange: () => draw() });
  };

  const focusCard = (lane, i) => {
    const el = grid[lane]?.[i];
    if (!el) return;
    for (const col of grid) for (const c of col) c.setAttribute('tabindex', '-1');
    el.setAttribute('tabindex', '0');
    el.focus();
  };

  function draw() {
    const style = make('style');
    style.textContent = BASE_CSS + CSS;
    root.style.setProperty('--vc-lane-width', `${s.width}px`);
    const message = (t) => {
      const p = make('p', 'vc-list-message', t);
      p.setAttribute('role', 'status');
      root.replaceChildren(style, p);
    };
    if (s.error) return message(`Board: ${s.error}`);
    if (!feed) return;
    const { list, loading, error } = feed.state;
    if (!list) return message(loading ? 'Reading the list…' : error || 'No list on this screen');
    const { lanes, error: bad } = lanesOf(list, s);
    if (bad) return message(bad);
    const actions = actionsOf(list, s.actions);
    const fallback = defaultAction(list, s.default);
    const active = doc.activeElement && root.contains(doc.activeElement) ? doc.activeElement.dataset?.key : null;
    grid = [];

    const board = make('div', 'vc-board-lanes');
    let first = true;
    lanes.forEach((lane, li) => {
      const col = make('section', 'vc-lane');
      const heading = make('h3', '', lane.label);
      heading.append(make('span', '', String(lane.cards.length)));
      const id = `vc-lane-${li}-${Math.random().toString(36).slice(2, 8)}`;
      heading.id = id;
      const ul = make('ul');
      ul.setAttribute('aria-labelledby', id);
      grid.push([]);
      if (lane.cards.length === 0) ul.append(make('li', 'vc-lane-empty', 'None'));
      lane.cards.forEach((c, i) => {
        const canRun = !!(fallback && c.record.option);
        const card = make('li', ['vc-card', ROLES.has(c.role) && `vc-role-${c.role}`, canRun && 'vc-card-clickable'].filter(Boolean).join(' '));
        card.dataset.key = `${c.record.page}:${c.record.index}`;
        card.setAttribute('tabindex', first ? '0' : '-1');
        first = false;
        card.setAttribute('aria-label', [c.title, c.subtitle, lane.label].filter(Boolean).join(', '));
        if (canRun) {
          card.title = fallback.label;
          card.addEventListener('click', () => feed.run(c.record, fallback.value));
        }
        card.addEventListener('keydown', (e) => {
          if (e.target !== card) return;
          const moves = { ArrowDown: [0, 1], ArrowUp: [0, -1], ArrowRight: [1, 0], ArrowLeft: [-1, 0] };
          const m = moves[e.key];
          if (m) {
            e.preventDefault();
            let l = li + m[0];
            // Skip empty lanes going sideways.
            while (m[0] && grid[l] && grid[l].length === 0) l += m[0];
            if (!grid[l]?.length) return;
            focusCard(l, Math.min(Math.max(i + m[1], 0), grid[l].length - 1));
          } else if (e.key === 'Enter' && canRun) {
            e.preventDefault();
            e.stopPropagation();
            feed.run(c.record, fallback.value);
          }
        });
        card.append(make('h4', '', c.title || '—'));
        if (c.subtitle) card.append(make('p', '', c.subtitle));
        const facts = c.facts.filter((f) => !same(f.label, s.column));
        if (facts.length) {
          const dl = make('dl');
          for (const f of facts) dl.append(make('dt', '', f.label), make('dd', '', f.value));
          card.append(dl);
        }
        if (c.record.option && actions.length) {
          const bar = make('div', 'vc-card-actions');
          for (const a of actions) {
            const b = make('button', '', a.label);
            b.type = 'button';
            b.dataset.option = a.value;
            b.setAttribute('aria-label', `${a.label} ${c.title}`.trim());
            b.addEventListener('click', (e) => {
              e.stopPropagation();
              feed.run(c.record, a.value);
            });
            bar.append(b);
          }
          card.append(bar);
        }
        grid[li].push(card);
        ul.append(card);
      });
      col.append(heading, ul);
      board.append(col);
    });
    const parts = [style, board];
    if (list.preview) parts.push(make('p', 'vc-board-note', 'In the designer only the page showing is read.'));
    else if (s.list === 'all' && !list.complete) parts.push(make('p', 'vc-board-note', `Stopped after ${list.pages} pages; the rest of the list isn't shown.`));
    else if (s.list === 'page' && list.more) parts.push(make('p', 'vc-board-note', 'This page of the list only.'));
    root.replaceChildren(...parts);
    if (active) root.querySelector(`[data-key="${active}"]`)?.focus();
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
