// Veneer component: an indented list as a tree that opens and closes, e.g. a
// bill of materials, IFS folders or a menu hierarchy. Needs lib/lists.js.
//
// Place it over the list (Page tab ▸ Components ▸ Tree) and hide the list,
// its option legend and its More.../Bottom marker. Options (columns are found
// by their heading, ignoring case):
//   column   the column naming each item; default the first column
//   level    a column holding each row's level: "1", "2"…, dots (".2",
//            "..3"), or outline numbers ("1.2.3"). Without it, the level is
//            how far `column`'s text is indented on the screen
//   fields   other columns shown after each item's name, e.g. ["Qty", "UOM"]
//   open     how many levels start open; default all of them (a list over 300
//            rows starts with 1)
//   default  the list option a click on an item (or Enter on it) runs
//   list     "all" (default) reads the whole list, as Export does; "page"
//            shows the page showing
//   maxPages stop reading after this many pages; default 100
//
// Keys, as in any tree: Up and Down move, Right opens an item (or goes to its
// first child), Left closes it (or goes to its parent), Home and End go to
// the first and last, * opens every item at that level.

import { BASE_CSS, ROLES, columnIndex, defaultAction, headingsOption, listFeed, listScope, maker, pagesOption, text } from './lib/lists.js';

export const label = 'Tree';

/** Lists longer than this start with only the top level open. */
export const BIG = 300;

/** The options, checked; `error` says what is wrong. */
export function settings(options = {}) {
  const o = options && typeof options === 'object' ? options : {};
  const s = { column: text(o.column), level: text(o.level), error: '' };
  s.fields = headingsOption(o, 'fields', s) ?? [];
  s.default = o.default === undefined || o.default === null ? '' : String(o.default).trim();
  s.open = null;
  if (o.open !== undefined) {
    const n = Math.round(Number(o.open));
    if (Number.isFinite(n) && n >= 0) s.open = n;
    else s.error ||= '"open" must be a number of levels';
  }
  const scope = listScope(o);
  s.list = scope.scope;
  s.error ||= scope.error;
  pagesOption(o, s);
  return s;
}

/** A level from a level column's text: "3", "..3", "...", "1.2.3"; 0 when it has none. */
export function levelOf(value) {
  const t = String(value ?? '').trim();
  if (/^\d+$/.test(t)) return Number(t);
  let m;
  if ((m = /^(\.+)(\d+)?$/.exec(t))) return m[2] ? Number(m[2]) : m[1].length + 1;
  if (/^\d+(\.\d+)+\.?$/.test(t)) return t.replace(/\.$/, '').split('.').length;
  return 0;
}

/** Leading spaces as levels: the smallest step in from the least indented row is one level. */
export function indentLevels(texts) {
  const indents = texts.map((t) => (t.trim() === '' ? null : t.length - t.trimStart().length));
  const used = [...new Set(indents.filter((n) => n !== null))].sort((a, b) => a - b);
  const base = used[0] ?? 0;
  const steps = used.slice(1).map((n, i) => n - used[i]).filter((d) => d > 0);
  const step = steps.length ? Math.min(...steps) : 1;
  return indents.map((n) => (n === null ? 1 : Math.round((n - base) / step) + 1));
}

/**
 * The tree: each record as a node { record, name, facts, level, children },
 * under the nearest row above it with a lower level. Returns the top nodes.
 */
export function buildTree(list, s) {
  const k = s.column ? columnIndex(list.columns, s.column) : 0;
  if (k < 0) return { error: `No “${s.column}” column in the list` };
  const lk = s.level ? columnIndex(list.columns, s.level) : -1;
  if (s.level && lk < 0) return { error: `No “${s.level}” column in the list` };
  const facts = s.fields.map((h) => ({ h, k: columnIndex(list.columns, h) })).filter((f) => f.k >= 0);
  const levels = lk >= 0 ? list.records.map((r) => Math.max(1, levelOf(r.cells[lk]))) : indentLevels(list.records.map((r) => r.raw?.[k] ?? r.cells[k] ?? ''));
  const top = [];
  const stack = [];
  list.records.forEach((r, i) => {
    const node = { record: r, name: (r.cells[k] ?? '').trim(), facts: facts.map((f) => ({ label: f.h, value: r.cells[f.k] ?? '' })), level: levels[i], children: [], key: `${r.page}:${r.index}` };
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    // A jump of more than one level hangs it under the nearest parent all the same.
    (stack.length ? stack[stack.length - 1].children : top).push(node);
    node.depth = stack.length + 1;
    stack.push(node);
  });
  return { nodes: top };
}

/** Every node, depth first. */
export function walk(nodes, out = []) {
  for (const n of nodes) {
    out.push(n);
    walk(n.children, out);
  }
  return out;
}

const CSS = `
.vc-tree { height: 100%; display: flex; flex-direction: column; gap: 6px; font-size: 13px; min-height: 0; }
.vc-tree .vc-tree-bar { display: flex; gap: 6px; align-items: center; }
.vc-tree .vc-tree-bar span { margin-left: auto; color: var(--text-muted, #666); }
.vc-tree ul { margin: 0; padding: 0; list-style: none; }
.vc-tree > .vc-tree-scroll { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--border, #e5e7eb); border-radius: 6px; padding: 4px 0; }
.vc-tree li > .vc-node { display: flex; align-items: baseline; gap: 6px; padding: 1px 8px 1px calc(8px + (var(--depth) - 1) * 18px); white-space: nowrap; }
.vc-tree li:focus-visible > .vc-node { outline: 2px solid var(--focus, var(--accent, #2563eb)); outline-offset: -2px; }
.vc-tree li { outline: none; }
.vc-tree li > .vc-node:hover { background: var(--surface-2, #f4f4f5); }
.vc-tree .vc-twisty { width: 14px; flex: none; text-align: center; color: var(--text-muted, #666); cursor: pointer; user-select: none; }
.vc-tree .vc-name { font-weight: 550; }
.vc-tree .vc-runnable .vc-name { cursor: pointer; }
.vc-tree .vc-runnable .vc-name:hover { text-decoration: underline; }
.vc-tree .vc-facts { color: var(--text-muted, #666); }
.vc-tree li[aria-expanded=false] > ul { display: none; }
.vc-tree .vc-role-danger > .vc-node .vc-name { color: var(--danger, #dc2626); }
.vc-tree .vc-role-warning > .vc-node .vc-name { color: var(--warning, #d97706); }
.vc-tree .vc-role-muted > .vc-node { opacity: 0.6; }
.vc-tree .vc-tree-note { margin: 0; color: var(--text-muted, #666); }
`;

export function mount(element, ctx) {
  const doc = element.ownerDocument;
  const make = maker(doc);
  const root = make('section', 'vc-list vc-tree');
  element.append(root);
  let current = ctx;
  let s = settings(ctx.options);
  let feed = null;
  /** Open items by key, kept across redraws; null until the first list. */
  let open = null;
  let focused = null;

  const start = () => {
    feed?.stop();
    feed = null;
    open = null;
    feed = s.error ? null : listFeed(current, { scope: s.list, headings: [s.column, s.level, ...s.fields].filter(Boolean), maxPages: s.maxPages, onChange: () => draw() });
  };

  function draw(focus = false) {
    const style = make('style');
    style.textContent = BASE_CSS + CSS;
    const message = (t) => {
      const p = make('p', 'vc-list-message', t);
      p.setAttribute('role', 'status');
      root.replaceChildren(style, p);
    };
    if (s.error) return message(`Tree: ${s.error}`);
    if (!feed) return;
    const { list, loading, error } = feed.state;
    if (!list) return message(loading ? 'Reading the list…' : error || 'No list on this screen');
    const built = buildTree(list, s);
    if (built.error) return message(built.error);
    const all = walk(built.nodes);
    if (open === null) {
      const levels = s.open ?? (list.records.length > BIG ? 1 : Infinity);
      open = new Set(all.filter((n) => n.children.length && n.depth <= levels).map((n) => n.key));
    }
    const fallback = defaultAction(list, s.default);
    const run = (n) => { if (fallback && n.record.option) feed.run(n.record, fallback.value); };

    /** The items showing (every parent open), in order: for the arrow keys. */
    const visible = [];
    const parentOf = new Map();
    const item = (n, parent) => {
      parentOf.set(n.key, parent);
      const li = make('li', ROLES.has(n.record.role) ? `vc-role-${n.record.role}` : '');
      li.setAttribute('role', 'treeitem');
      li.setAttribute('aria-level', String(n.depth));
      li.dataset.key = n.key;
      li.setAttribute('tabindex', '-1');
      li.setAttribute('aria-label', [n.name, ...n.facts.map((f) => `${f.label} ${f.value}`)].join(', '));
      if (n.children.length) li.setAttribute('aria-expanded', String(open.has(n.key)));
      const row = make('div', `vc-node${fallback && n.record.option ? ' vc-runnable' : ''}`);
      row.style.setProperty('--depth', String(n.depth));
      const twisty = make('span', 'vc-twisty', n.children.length ? (open.has(n.key) ? '▾' : '▸') : '');
      twisty.setAttribute('aria-hidden', 'true');
      twisty.addEventListener('click', (e) => { e.stopPropagation(); toggle(n); });
      const name = make('span', 'vc-name', n.name || '—');
      if (fallback && n.record.option) {
        name.title = fallback.label;
        name.addEventListener('click', () => run(n));
      }
      row.append(twisty, name);
      const facts = n.facts.filter((f) => f.value.trim()).map((f) => `${f.label} ${f.value.trim()}`).join(' · ');
      if (facts) row.append(make('span', 'vc-facts', facts));
      row.addEventListener('click', () => { focused = n.key; focusKey(n.key); });
      li.append(row);
      visible.push(n);
      if (n.children.length) {
        const ul = make('ul');
        ul.setAttribute('role', 'group');
        for (const c of n.children) {
          if (open.has(n.key)) ul.append(item(c, n));
          else parentOf.set(c.key, n);
        }
        li.append(ul);
      }
      return li;
    };
    function toggle(n, to = !open.has(n.key)) {
      if (!n.children.length) return;
      if (to) open.add(n.key);
      else open.delete(n.key);
      focused = n.key;
      draw(true);
    }
    function focusKey(key) {
      for (const el of root.querySelectorAll('[role=treeitem]')) el.setAttribute('tabindex', el.dataset.key === key ? '0' : '-1');
      root.querySelector(`[role=treeitem][data-key="${key}"]`)?.focus();
    }

    const tree = make('ul');
    tree.setAttribute('role', 'tree');
    tree.setAttribute('aria-label', s.column || list.columns[0] || 'Tree');
    for (const n of built.nodes) tree.append(item(n, null));
    tree.addEventListener('keydown', (e) => {
      const key = e.target?.dataset?.key;
      const i = visible.findIndex((n) => n.key === key);
      if (i < 0) return;
      const n = visible[i];
      const go = (m) => { if (m) { e.preventDefault(); focused = m.key; focusKey(m.key); } };
      switch (e.key) {
        case 'ArrowDown': return go(visible[i + 1]);
        case 'ArrowUp': return go(visible[i - 1]);
        case 'Home': return go(visible[0]);
        case 'End': return go(visible[visible.length - 1]);
        case 'ArrowRight':
          e.preventDefault();
          if (n.children.length && !open.has(n.key)) return toggle(n, true);
          return go(n.children[0]);
        case 'ArrowLeft':
          e.preventDefault();
          if (n.children.length && open.has(n.key)) return toggle(n, false);
          return go(parentOf.get(n.key));
        case '*': {
          e.preventDefault();
          const siblings = parentOf.get(n.key)?.children ?? built.nodes;
          for (const x of siblings) if (x.children.length) open.add(x.key);
          focused = n.key;
          return draw(true);
        }
        case 'Enter':
          e.preventDefault();
          e.stopPropagation(); // not Enter for the host
          return run(n);
      }
    });

    const bar = make('div', 'vc-tree-bar');
    const btn = (label, fn) => { const b = make('button', '', label); b.type = 'button'; b.addEventListener('click', fn); return b; };
    bar.append(
      btn('Open all', () => { open = new Set(all.filter((n) => n.children.length).map((n) => n.key)); draw(); }),
      btn('Close all', () => { open = new Set(); draw(); }),
      make('span', '', `${list.records.length} items`),
    );
    const scroll = make('div', 'vc-tree-scroll');
    scroll.append(tree);
    const parts = [style, bar, scroll];
    if (list.preview) parts.push(make('p', 'vc-tree-note', 'In the designer only the page showing is read.'));
    else if (s.list === 'all' && !list.complete) parts.push(make('p', 'vc-tree-note', `Stopped after ${list.pages} pages.`));
    else if (s.list === 'page' && list.more) parts.push(make('p', 'vc-tree-note', 'This page of the list only.'));
    root.replaceChildren(...parts);
    const target = focused && visible.some((n) => n.key === focused) ? focused : visible[0]?.key;
    if (target) {
      for (const el of root.querySelectorAll('[role=treeitem]')) el.setAttribute('tabindex', el.dataset.key === target ? '0' : '-1');
      if (focus) focusKey(target);
    }
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
