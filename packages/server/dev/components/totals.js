// Veneer component: totals of a list's columns as tiles, e.g. "42 orders" and
// "$18,240.00 total". Needs lib/lists.js beside it.
//
// Place it above or below the list (Page tab ▸ Components ▸ Totals). Options:
//   totals    what to show, in order; each one is either a string such as
//             "count", "sum:Amount", "average:Amount", "min:Price" or
//             "max:Ship date", or an object:
//               { "of": "sum", "column": "Amount", "label": "total",
//                 "decimals": 2, "currency": "USD",
//                 "where": { "Status": "HELD" } }
//             `of` is count, sum, average, min or max; `label` is the text
//             under the number (default "rows", "total Amount", ...);
//             `decimals` defaults to the most the column shows; `currency`
//             is an ISO code; `where` counts only rows whose columns have
//             those values (ignoring case). Default: ["count"]
//   list      "page" (default) totals the page showing; "all" the whole list,
//             read as Export does (with a whole-list table on the same
//             screen, the list is read once for both)
//   title     a caption above the tiles
//
// min and max work on numbers, or on dates when the column holds dates.
// Values that aren't numbers are left out of sum, average, min and max.

import { BASE_CSS, columnIndex, isoDate, listFeed, listScope, maker, parseDate, parseNumber, readNumber, same, text } from './lib/lists.js';

export const label = 'Totals';

export const KINDS = Object.freeze(['count', 'sum', 'average', 'min', 'max']);
const NAMES = { count: 'rows', sum: 'total', average: 'average', min: 'lowest', max: 'highest' };

/** One total, from its string or object form; `error` says what is wrong. */
export function parseTotal(t) {
  if (typeof t === 'string') {
    const [of, ...rest] = t.split(':');
    return parseTotal({ of: of.trim(), column: rest.join(':').trim() || undefined });
  }
  if (!t || typeof t !== 'object') return { error: 'each total must be a string like "sum:Amount" or an object' };
  const of = String(t.of ?? 'count').trim().toLowerCase();
  if (!KINDS.includes(of)) return { error: `"${t.of}" isn't a total: use ${KINDS.join(', ')}` };
  const column = text(t.column);
  if (of !== 'count' && !column) return { error: `${of} needs a column, e.g. "${of}:Amount"` };
  const out = { of, column, label: text(t.label), where: {}, error: '' };
  if (t.decimals !== undefined) {
    const d = Math.round(Number(t.decimals));
    if (!(d >= 0 && d <= 10)) return { error: '"decimals" must be 0 to 10' };
    out.decimals = d;
  }
  if (t.currency !== undefined) {
    const c = text(t.currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) return { error: '"currency" must be a 3-letter code such as USD' };
    out.currency = c;
  }
  if (t.where !== undefined) {
    if (!t.where || typeof t.where !== 'object' || Array.isArray(t.where)) return { error: '"where" must be an object of column headings and values' };
    out.where = Object.fromEntries(Object.entries(t.where).map(([k, v]) => [k.trim(), String(v).trim()]));
  }
  return out;
}

/** The options, checked; `error` says what is wrong. */
export function settings(options = {}) {
  const o = options && typeof options === 'object' ? options : {};
  const s = { title: text(o.title), error: '' };
  const scope = listScope(o, 'page');
  s.list = scope.scope;
  s.error = scope.error;
  const raw = o.totals === undefined ? ['count'] : o.totals;
  if (!Array.isArray(raw) || raw.length === 0) {
    s.error ||= '"totals" must be a list, such as ["count", "sum:Amount"]';
    s.totals = [];
  } else {
    s.totals = raw.map(parseTotal);
    s.error ||= s.totals.find((t) => t.error)?.error ?? '';
  }
  return s;
}

/** How many decimals a column's values show: the most of any. */
export function decimalsOf(values) {
  return values.reduce((most, v) => Math.max(most, readNumber(v)?.decimals ?? 0), 0);
}

/**
 * Work out one total over a list's records: { value, text, label } or
 * { error }. `value` is a number (or for dates, the ISO date).
 */
export function compute(list, t, locale) {
  const where = Object.entries(t.where ?? {});
  const cols = where.map(([h]) => columnIndex(list.columns, h));
  if (cols.some((k) => k < 0)) return { error: `No “${where[cols.findIndex((k) => k < 0)][0]}” column` };
  const records = list.records.filter((r) => where.every(([, v], i) => same(r.cells[cols[i]], v)));
  const label = t.label || (t.of === 'count' ? NAMES.count : `${NAMES[t.of]} ${t.column}`);
  if (t.of === 'count') return { value: records.length, text: new Intl.NumberFormat(locale).format(records.length), label };
  const k = columnIndex(list.columns, t.column);
  if (k < 0) return { error: `No “${t.column}” column` };
  const values = records.map((r) => (r.cells[k] ?? '').trim()).filter(Boolean);
  const numbers = values.map(parseNumber).filter((n) => n !== undefined);
  // min and max of dates: the column has dates and no numbers.
  if ((t.of === 'min' || t.of === 'max') && numbers.length < values.length) {
    const dates = values.map((v) => parseDate(v)).filter(Boolean).map(isoDate).sort();
    if (dates.length === values.length && dates.length > 0) {
      const iso = t.of === 'min' ? dates[0] : dates[dates.length - 1];
      const at = values.find((v) => isoDate(parseDate(v)) === iso);
      return { value: iso, text: at, label };
    }
  }
  if (numbers.length === 0) return { value: null, text: '—', label };
  const value = t.of === 'sum' ? numbers.reduce((a, b) => a + b, 0)
    : t.of === 'average' ? numbers.reduce((a, b) => a + b, 0) / numbers.length
    : t.of === 'min' ? Math.min(...numbers) : Math.max(...numbers);
  const shown = decimalsOf(values);
  const decimals = t.decimals ?? (t.of === 'average' ? Math.max(shown, 1) : shown);
  const format = new Intl.NumberFormat(locale, {
    ...(t.currency ? { style: 'currency', currency: t.currency } : {}),
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return { value, text: format.format(value), label };
}

const CSS = `
.vc-totals { height: 100%; display: flex; flex-direction: column; gap: 4px; font-size: 13px; min-height: 0; }
.vc-totals .vc-totals-title { font-weight: 650; }
.vc-totals dl { margin: 0; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; min-height: 0; overflow: auto; }
.vc-totals .vc-total { display: flex; flex-direction: column-reverse; justify-content: center; padding: 4px 12px;
  border: 1px solid var(--border, #ccc); border-radius: 8px; background: var(--surface, #fff); min-width: 90px; }
.vc-totals dt { color: var(--text-muted, #666); font-size: 0.9em; }
.vc-totals dd { margin: 0; font-size: 1.4em; font-weight: 650; font-variant-numeric: tabular-nums; color: var(--text-strong, inherit); }
.vc-totals .vc-total-error dd { font-size: 1em; font-weight: normal; color: var(--danger, #dc2626); }
.vc-totals .vc-totals-note { color: var(--text-muted, #666); font-size: 0.9em; }
`;

export function mount(element, ctx) {
  const doc = element.ownerDocument;
  const make = maker(doc);
  const root = make('figure', 'vc-list vc-totals');
  root.style.margin = '0';
  element.append(root);
  let current = ctx;
  let s = settings(ctx.options);
  let feed = null;

  const headingsOf = (st) => st.totals.flatMap((t) => [t.column, ...Object.keys(t.where ?? {})]).filter(Boolean);
  const start = () => {
    feed?.stop();
    feed = null;
    feed = s.error ? null : listFeed(current, { scope: s.list, headings: headingsOf(s), onChange: () => draw() });
  };

  function draw() {
    const style = make('style');
    style.textContent = BASE_CSS + CSS;
    const parts = [style];
    if (s.title) parts.push(make('figcaption', 'vc-totals-title', s.title));
    const message = (t) => {
      const p = make('p', 'vc-list-message', t);
      p.setAttribute('role', 'status');
      root.replaceChildren(...parts, p);
    };
    if (s.error) return message(`Totals: ${s.error}`);
    if (!feed) return;
    const { list, loading, error } = feed.state;
    if (!list) return message(loading ? 'Reading the list…' : error || 'No list on this screen');
    const dl = make('dl');
    dl.setAttribute('aria-live', 'polite');
    const locale = doc.documentElement.lang || undefined;
    for (const t of s.totals) {
      const r = compute(list, t, locale);
      const tile = make('div', `vc-total${r.error ? ' vc-total-error' : ''}`);
      tile.append(make('dt', '', r.error ? (t.label || t.of) : r.label), make('dd', '', r.error ?? r.text));
      dl.append(tile);
    }
    parts.push(dl);
    if (s.list === 'page' && list.more) parts.push(make('p', 'vc-totals-note', 'This page only'));
    else if (s.list === 'all' && list.preview) parts.push(make('p', 'vc-totals-note', 'In the designer: this page only'));
    else if (s.list === 'all' && !list.complete) parts.push(make('p', 'vc-totals-note', `The first ${list.pages} pages only`));
    root.replaceChildren(...parts);
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
