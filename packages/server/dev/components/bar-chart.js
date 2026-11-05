// Veneer component: a chart of a list's columns: bars, stacked bars, lines,
// a pie or donut, or a sparkline. Needs lib/lists.js beside it.
//
// Place it near the list (Page tab ▸ Components ▸ Chart). Options (columns
// are found by their heading, ignoring case):
//   column    the column to chart, e.g. "Amount" (required); for bars, stacked
//             bars and lines, a list charts several: ["Open", "Shipped"]
//   label     the column naming each bar, point or slice; default the first
//             column
//   type      "bar" (default), "stacked", "line", "pie", "donut" or "sparkline"
//   title     a caption above the chart
//   list      "page" (default) charts the page showing; "all" the whole list,
//             read as Export does
//
// It redraws whenever the screen does (paging through the list, for example).
// Hover or focus a bar, point or slice for its value; the Table button shows
// the numbers as a table. A pie or donut shows up to seven slices and folds
// the rest into "Other"; it leaves out values below zero, as stacked bars do.
// Colors follow the theme: --chart-1 to --chart-8 override them.

import { BASE_CSS, columnIndex, listFeed, listScope, maker, parseNumber, text } from './lib/lists.js';

export const label = 'Chart';

export const TYPES = Object.freeze(['bar', 'stacked', 'line', 'pie', 'donut', 'sparkline']);
/** Slices a pie shows before folding the rest into "Other". */
export const MAX_SLICES = 7;
/** Series a chart shows: the palette's eight colors, never repeated. */
export const MAX_SERIES = 8;

/** The options, checked; `error` says what is wrong. */
export function settings(options = {}) {
  const o = options && typeof options === 'object' ? options : {};
  const raw = o.column ?? o.columns;
  const columns = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).map((c) => (typeof c === 'string' ? c.trim() : '')).filter(Boolean);
  const type = o.type === undefined ? 'bar' : String(o.type).trim().toLowerCase();
  const scope = listScope(o, 'page');
  const s = { columns, label: text(o.label), type, title: text(o.title), list: scope.scope, error: scope.error };
  if (!TYPES.includes(type)) s.error ||= `"type" must be one of ${TYPES.join(', ')}`;
  else if (columns.length === 0) s.error ||= 'Set the "column" option to the heading of the column to chart, e.g. "Amount"';
  else if (columns.length > 1 && ['pie', 'donut', 'sparkline'].includes(type)) s.error ||= `A ${type} charts one column`;
  else if (columns.length > MAX_SERIES) s.error ||= `At most ${MAX_SERIES} columns`;
  return s;
}

/**
 * The chart's data: a point per row that has a number in any charted column.
 * { series: [{ name }], points: [{ name, values: (number|null)[], texts }] },
 * or { error }.
 */
export function chartData(list, s) {
  const ks = s.columns.map((h) => columnIndex(list.columns, h));
  const missing = s.columns.filter((_, i) => ks[i] < 0);
  if (missing.length) return { error: `No ${missing.map((h) => `“${h}”`).join(', ')} column in the list` };
  const n = s.label ? columnIndex(list.columns, s.label) : 0;
  if (n < 0) return { error: `No “${s.label}” column in the list` };
  const points = list.records
    .map((r) => ({ name: r.cells[n] ?? '', texts: ks.map((k) => r.cells[k] ?? ''), values: ks.map((k) => parseNumber(r.cells[k] ?? '') ?? null) }))
    .filter((p) => p.values.some((v) => v !== null));
  return { series: ks.map((k) => ({ name: list.columns[k] })), points };
}

/** About `count` round tick values from 0 (or below) to past the max: [0, 250, 500, 750, 1000]. */
export function niceTicks(lo, hi, count = 4) {
  const min = Math.min(0, lo);
  const max = Math.max(0, hi);
  if (max === min) return [0, 1];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((st) => st >= raw) ?? 10 * mag;
  const ticks = [];
  for (let v = Math.floor(min / step) * step; v < max + step * 0.999; v += step) ticks.push(Number(v.toPrecision(12)));
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/** Stacked bars: each point's segments as [from, to], skipping values below zero; and the tallest stack. */
export function stacks(points) {
  let top = 0;
  const out = points.map((p) => {
    let at = 0;
    const segs = p.values.map((v) => {
      if (v === null || v <= 0) return null;
      const seg = [at, at + v];
      at += v;
      return seg;
    });
    top = Math.max(top, at);
    return segs;
  });
  return { stacks: out, top };
}

/** A pie's slices: values above zero, largest first, past MAX_SLICES folded into "Other". */
export function slices(points) {
  const items = points.map((p) => ({ name: p.name, value: p.values[0], text: p.texts[0] })).filter((p) => p.value !== null && p.value > 0);
  const total = items.reduce((a, p) => a + p.value, 0);
  if (total === 0) return [];
  // Order is the list's; fold the smallest ones only if there are too many.
  let kept = items;
  if (items.length > MAX_SLICES) {
    const big = new Set([...items].sort((a, b) => b.value - a.value).slice(0, MAX_SLICES - 1));
    kept = items.filter((p) => big.has(p));
    const rest = items.filter((p) => !big.has(p)).reduce((a, p) => a + p.value, 0);
    kept.push({ name: 'Other', value: rest, text: String(Number(rest.toPrecision(12))), other: true });
  }
  let angle = 0;
  return kept.map((p) => {
    const start = angle;
    angle += (p.value / total) * Math.PI * 2;
    return { ...p, share: p.value / total, start, end: angle };
  });
}

/** An SVG path for a pie slice (inner 0) or donut ring segment, angles clockwise from 12 o'clock. */
export function arcPath(cx, cy, r, inner, start, end) {
  const pt = (rad, a) => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)].map((v) => Number(v.toFixed(2)));
  // A whole circle can't be one arc: draw it as two halves.
  if (end - start >= Math.PI * 2 - 1e-9) {
    const mid = start + Math.PI;
    return `${arcPath(cx, cy, r, inner, start, mid)} ${arcPath(cx, cy, r, inner, mid, end)}`;
  }
  const large = end - start > Math.PI ? 1 : 0;
  const [x1, y1] = pt(r, start);
  const [x2, y2] = pt(r, end);
  if (inner <= 0) return `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`;
  const [x3, y3] = pt(inner, end);
  const [x4, y4] = pt(inner, start);
  return `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 ${large} 0 ${x4},${y4} Z`;
}

/** Short tick text: 1200 → "1.2K". */
function short(v, locale) {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

const CSS = `
.vc-chart { --s1: var(--chart-1, #2a78d6); --s2: var(--chart-2, #eb6834); --s3: var(--chart-3, #1baf7a); --s4: var(--chart-4, #eda100);
  --s5: var(--chart-5, #e87ba4); --s6: var(--chart-6, #008300); --s7: var(--chart-7, #6250d6); --s8: var(--chart-8, #e34948);
  margin: 0; height: 100%; display: flex; flex-direction: column; gap: 4px; font-size: 12px; min-height: 0; position: relative; color: var(--text, inherit); }
@media (prefers-color-scheme: dark) {
  .vc-chart { --s1: var(--chart-1, #3987e5); --s2: var(--chart-2, #d95926); --s3: var(--chart-3, #199e70); --s4: var(--chart-4, #c98500);
    --s5: var(--chart-5, #d55181); --s6: var(--chart-6, #008300); --s7: var(--chart-7, #9085e9); --s8: var(--chart-8, #e66767); }
}
.vc-chart .vc-chart-head { display: flex; align-items: center; gap: 8px; }
.vc-chart figcaption { font-weight: 650; }
.vc-chart .vc-chart-legend { display: flex; flex-wrap: wrap; gap: 2px 10px; margin: 0; padding: 0; list-style: none; color: var(--text-muted, #666); }
.vc-chart .vc-chart-legend li { display: flex; align-items: center; gap: 4px; }
.vc-chart .vc-chart-legend i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.vc-chart .vc-chart-head button { margin-left: auto; font-size: 0.85em; padding: 0 6px; }
.vc-chart .vc-chart-plot { flex: 1; min-height: 0; position: relative; }
.vc-chart svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.vc-chart svg text { fill: var(--text-muted, #666); font-size: 11px; }
.vc-chart .vc-grid { stroke: var(--border, #e5e7eb); stroke-width: 1; }
.vc-chart .vc-base { stroke: var(--text-muted, #888); stroke-width: 1; }
.vc-chart .vc-hit { fill: transparent; cursor: default; outline: none; }
.vc-chart .vc-hit:hover, .vc-chart .vc-hit:focus-visible { fill: color-mix(in srgb, var(--text, #000) 6%, transparent); }
.vc-chart .vc-slice { stroke: var(--surface, #fff); stroke-width: 2; outline: none; }
.vc-chart .vc-slice:focus-visible, .vc-chart .vc-slice:hover { opacity: 0.85; }
.vc-chart .vc-line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.vc-chart .vc-dot { stroke: var(--surface, #fff); stroke-width: 2; }
.vc-chart .vc-tip { position: absolute; pointer-events: none; z-index: 2; padding: 4px 8px; border-radius: 6px; white-space: nowrap;
  background: var(--surface, #fff); color: var(--text, inherit); border: 1px solid var(--border, #ccc); box-shadow: var(--shadow, 0 2px 8px rgb(0 0 0 / 15%)); }
.vc-chart .vc-tip b { font-weight: 650; }
.vc-chart .vc-tip i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; margin-right: 4px; }
.vc-chart .vc-chart-table { flex: 1; min-height: 0; overflow: auto; }
.vc-chart table { border-collapse: collapse; width: 100%; }
.vc-chart th, .vc-chart td { padding: 2px 8px; text-align: left; border-bottom: 1px solid var(--border, #e5e7eb); }
.vc-chart td.vc-num, .vc-chart th.vc-num { text-align: right; font-variant-numeric: tabular-nums; }
.vc-chart .vc-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
`;

const NS = 'http://www.w3.org/2000/svg';
const color = (i) => `var(--s${(i % MAX_SERIES) + 1})`;
const OTHER = 'var(--text-muted, #8a8a8a)';

export function mount(element, ctx) {
  const doc = element.ownerDocument;
  const make = maker(doc);
  const root = make('figure', 'vc-list vc-chart');
  element.append(root);
  let current = ctx;
  let s = settings(ctx.options);
  let feed = null;
  let asTable = false;
  let observer = null;
  const svg = (tag, attrs = {}) => {
    const node = doc.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  };

  const start = () => {
    feed?.stop();
    feed = null;
    feed = s.error ? null : listFeed(current, { scope: s.list, headings: [...s.columns, ...(s.label ? [s.label] : [])], onChange: () => draw() });
  };

  function draw() {
    const style = make('style');
    style.textContent = BASE_CSS + CSS;
    const head = make('div', 'vc-chart-head');
    if (s.title) head.append(make('figcaption', '', s.title));
    const message = (t) => {
      const p = make('p', 'vc-list-message', t);
      p.setAttribute('role', 'status');
      root.replaceChildren(style, head, p);
    };
    if (s.error) return message(s.error);
    if (!feed) return;
    const { list, loading, error } = feed.state;
    if (!list) return message(loading ? 'Reading the list…' : error || 'No list on this screen');
    const data = chartData(list, s);
    if (data.error) return message(data.error);
    if (data.points.length === 0) return message(`No numbers in the ${s.columns.map((h) => `“${h}”`).join(', ')} column on this screen`);
    const locale = doc.documentElement.lang || undefined;
    const pie = s.type === 'pie' || s.type === 'donut';
    const parts = pie ? slices(data.points) : null;
    if (pie && parts.length === 0) return message(`No values above zero in “${s.columns[0]}”`);

    // The legend: for two or more series, and for every pie.
    if (data.series.length > 1 || pie) {
      const legend = make('ul', 'vc-chart-legend');
      const entries = pie ? parts.map((p, i) => ({ name: p.name, color: p.other ? OTHER : color(i) })) : data.series.map((x, i) => ({ name: x.name, color: color(i) }));
      for (const e of entries) {
        const li = make('li');
        const sw = make('i');
        sw.style.background = e.color;
        li.append(sw, doc.createTextNode(e.name || '—'));
        legend.append(li);
      }
      head.append(legend);
    }
    if (s.type !== 'sparkline') {
      const toggle = make('button', '', asTable ? 'Chart' : 'Table');
      toggle.type = 'button';
      toggle.setAttribute('aria-pressed', String(asTable));
      toggle.title = asTable ? 'Show the chart' : 'Show the numbers as a table';
      toggle.addEventListener('click', () => {
        asTable = !asTable;
        draw();
        root.querySelector('.vc-chart-head button')?.focus();
      });
      head.append(toggle);
    }

    const table = make('table');
    const thead = make('tr');
    thead.append(make('th', '', s.label || list.columns[0] || ''), ...data.series.map((x) => make('th', 'vc-num', x.name)));
    table.append(make('thead'), make('tbody'));
    table.tHead.append(thead);
    for (const p of data.points) {
      const tr = make('tr');
      tr.append(make('td', '', p.name), ...p.texts.map((t) => make('td', 'vc-num', t)));
      table.tBodies[0].append(tr);
    }
    if (asTable) {
      const wrap = make('div', 'vc-chart-table');
      wrap.append(table);
      return root.replaceChildren(style, head, wrap);
    }
    // Screen readers get the table; the drawing is for the eye.
    const sr = make('div', 'vc-sr');
    sr.append(table);
    const plot = make('div', 'vc-chart-plot');
    plot.setAttribute('aria-hidden', 'true');
    const tip = make('div', 'vc-tip');
    tip.hidden = true;
    root.replaceChildren(style, ...(s.type === 'sparkline' && !s.title ? [] : [head]), plot, tip, sr);

    const w = Math.max(plot.clientWidth || 300, 40);
    const h = Math.max(plot.clientHeight || 120, 24);
    const chart = svg('svg', { viewBox: `0 0 ${w} ${h}`, role: 'presentation' });
    plot.append(chart);

    const showTip = (target, title, rows) => {
      tip.replaceChildren(make('b', '', title || '—'));
      for (const r of rows) {
        const line = make('div');
        const sw = make('i');
        sw.style.background = r.color;
        line.append(sw, doc.createTextNode(`${r.name}: ${r.text}`));
        tip.append(line);
      }
      tip.hidden = false;
      const box = target.getBoundingClientRect();
      const host = root.getBoundingClientRect();
      const left = Math.min(Math.max(0, box.left - host.left + box.width / 2 - tip.offsetWidth / 2), Math.max(0, host.width - tip.offsetWidth));
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(0, box.top - host.top - tip.offsetHeight - 6)}px`;
    };
    const hideTip = () => { tip.hidden = true; };
    const hoverable = (node, title, rows) => {
      node.addEventListener('pointerenter', () => showTip(node, title, rows));
      node.addEventListener('pointerleave', hideTip);
      node.addEventListener('focus', () => showTip(node, title, rows));
      node.addEventListener('blur', hideTip);
    };
    const rowsOf = (p) => data.series.map((x, i) => ({ name: x.name, text: p.texts[i] || '—', color: color(i) })).filter((_, i) => p.values[i] !== null);

    if (pie) {
      const r = Math.max(4, Math.min(w, h) / 2 - 2);
      const inner = s.type === 'donut' ? r * 0.6 : 0;
      parts.forEach((p, i) => {
        const path = svg('path', { d: arcPath(w / 2, h / 2, r, inner, p.start, p.end), class: 'vc-slice', fill: p.other ? OTHER : color(i) });
        hoverable(path, p.name, [{ name: s.columns[0], text: `${p.text} (${new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(p.share)})`, color: p.other ? OTHER : color(i) }]);
        chart.append(path);
      });
      if (s.type === 'donut') {
        const total = parts.reduce((a, p) => a + p.value, 0);
        const label = svg('text', { x: w / 2, y: h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', style: 'font-size: 14px; font-weight: 650; fill: var(--text-strong, currentColor)' });
        label.textContent = short(total, locale);
        chart.append(label);
      }
      return;
    }

    const spark = s.type === 'sparkline';
    const stacked = s.type === 'stacked' ? stacks(data.points) : null;
    const values = data.points.flatMap((p) => p.values.filter((v) => v !== null));
    const lo = spark || s.type === 'line' ? Math.min(...values) : Math.min(0, ...values);
    const hi = stacked ? stacked.top : Math.max(...values);
    const ticks = spark ? [lo, hi === lo ? lo + 1 : hi] : niceTicks(s.type === 'line' ? Math.min(0, lo) : lo, hi);
    const yMin = ticks[0];
    const yMax = ticks[ticks.length - 1];
    const left = spark ? 2 : Math.max(...ticks.map((t) => short(t, locale).length)) * 6.5 + 6;
    const bottom = spark ? 2 : 16;
    const top = spark ? 3 : 6;
    const right = spark ? 3 : 4;
    const pw = Math.max(4, w - left - right);
    const ph = Math.max(4, h - top - bottom);
    const y = (v) => top + ph - ((v - yMin) / (yMax - yMin || 1)) * ph;
    const n = data.points.length;
    const band = pw / n;

    if (!spark) {
      for (const t of ticks) {
        chart.append(svg('line', { x1: left, x2: left + pw, y1: y(t), y2: y(t), class: t === 0 ? 'vc-base' : 'vc-grid' }));
        const tx = svg('text', { x: left - 4, y: y(t), 'text-anchor': 'end', 'dominant-baseline': 'central' });
        tx.textContent = short(t, locale);
        chart.append(tx);
      }
      // Names under the bars: as many as fit without running into each other.
      const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / 60))));
      data.points.forEach((p, i) => {
        if (i % every) return;
        const tx = svg('text', { x: left + band * (i + 0.5), y: top + ph + 12, 'text-anchor': 'middle' });
        const max = Math.max(3, Math.floor((band * every) / 6.5));
        tx.textContent = p.name.length > max ? `${p.name.slice(0, max - 1)}…` : p.name;
        chart.append(tx);
      });
    }

    if (s.type === 'bar' || stacked) {
      const groups = stacked ? 1 : data.series.length;
      const gap = 2;
      const bw = Math.max(1, Math.min(48, (band * 0.7) / groups));
      data.points.forEach((p, i) => {
        const x0 = left + band * (i + 0.5) - (bw * groups + gap * (groups - 1)) / 2;
        p.values.forEach((v, j) => {
          if (v === null) return;
          let from = 0;
          let to = v;
          let x = x0 + j * (bw + gap);
          if (stacked) {
            const seg = stacked.stacks[i][j];
            if (!seg) return;
            [from, to] = seg;
            x = x0;
          }
          const yTop = y(Math.max(from, to));
          const yBot = y(Math.min(from, to));
          // A 2px surface gap between stacked segments.
          const hgt = Math.max(0, yBot - yTop - (stacked && from > 0 ? 2 : 0));
          // Round only the end away from the baseline.
          const r = Math.min(4, bw / 2, hgt);
          const up = to >= from && v >= 0;
          const isTop = !stacked || j === p.values.map((q, k) => (stacked.stacks[i][k] ? k : -1)).reduce((a, b) => Math.max(a, b), -1);
          const d = isTop && r > 0
            ? (up
              ? `M${x},${yTop + hgt} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + bw - r} Q${x + bw},${yTop} ${x + bw},${yTop + r} V${yTop + hgt} Z`
              : `M${x},${yTop} V${yTop + hgt - r} Q${x},${yTop + hgt} ${x + r},${yTop + hgt} H${x + bw - r} Q${x + bw},${yTop + hgt} ${x + bw},${yTop + hgt - r} V${yTop} Z`)
            : `M${x},${yTop} H${x + bw} V${yTop + hgt} H${x} Z`;
          chart.append(svg('path', { d, fill: color(j) }));
        });
        const hit = svg('rect', { x: left + band * i, y: top, width: band, height: ph, class: 'vc-hit' });
        hoverable(hit, p.name, rowsOf(p));
        chart.append(hit);
      });
      return;
    }

    // Lines and the sparkline.
    const x = (i) => left + (n === 1 ? pw / 2 : (pw * i) / (n - 1));
    data.series.forEach((_, j) => {
      let d = '';
      let pen = false;
      data.points.forEach((p, i) => {
        const v = p.values[j];
        if (v === null) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
        pen = true;
      });
      chart.append(svg('path', { d: d.trim(), class: 'vc-line', stroke: color(j) }));
      if (spark) {
        const last = [...data.points.keys()].reverse().find((i) => data.points[i].values[j] !== null);
        chart.append(svg('circle', { cx: x(last), cy: y(data.points[last].values[j]), r: 3, fill: color(j) }));
      } else if (n <= 30) {
        data.points.forEach((p, i) => {
          if (p.values[j] !== null) chart.append(svg('circle', { cx: x(i), cy: y(p.values[j]), r: 4, fill: color(j), class: 'vc-dot' }));
        });
      }
    });
    if (spark) return;
    // A crosshair column per point: hover shows every series there.
    data.points.forEach((p, i) => {
      const hit = svg('rect', { x: x(i) - (n === 1 ? pw : pw / (n - 1)) / 2, y: top, width: n === 1 ? pw : pw / (n - 1), height: ph, class: 'vc-hit' });
      hoverable(hit, p.name, rowsOf(p));
      chart.append(hit);
    });
  }

  start();
  draw();
  if (typeof ResizeObserver === 'function') {
    let size = '';
    observer = new ResizeObserver(() => {
      const now = `${element.clientWidth}x${element.clientHeight}`;
      if (now !== size) { size = now; draw(); }
    });
    observer.observe(element);
  }
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
      observer?.disconnect();
      feed?.stop();
      root.remove();
    },
  };
}
