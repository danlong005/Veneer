// Example Veneer component: a bar chart of a list column on the screen.
//
// Options:
//   column  the heading of the column to chart, e.g. "Amount" (required)
//   label   the heading of the column naming each bar (default: the first column)
//   title   a caption above the chart
//
// It redraws whenever the screen does (paging through the list, for example).
// Negative values are drawn in the error color.

export const label = 'Bar chart';

const same = (a, b) => a.trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/**
 * A number as a 5250 screen shows it: "1,234.50", "12.50-", "-12,50". With
 * both "." and ",", the last is the decimal point; with one, it is a thousands
 * separator when it is used more than once or three digits follow it.
 */
function parseNumber(text) {
  let s = text.trim().toUpperCase().replace(/\s+/g, '');
  const negative = /^-|-$|CR$/.test(s);
  s = s.replace(/^[-+]|[-+]$|CR$/g, '');
  if (!/^[\d.,]*\d[\d.,]*$/.test(s)) return undefined;
  const seps = s.match(/[.,]/g) ?? [];
  const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  const decimal = seps.length > 0 && (new Set(seps).size > 1 || (seps.length === 1 && s.length - last - 1 !== 3));
  const n = Number(decimal ? `${s.slice(0, last).replace(/[.,]/g, '')}.${s.slice(last + 1)}` : s.replace(/[.,]/g, ''));
  return Number.isFinite(n) ? (negative ? -n : n) : undefined;
}

function draw(element, ctx) {
  const { column, label: labelColumn, title } = ctx.options;
  const table = ctx.tables.find((t) => t.columns.some((h) => same(h, column)));
  element.replaceChildren();
  const box = document.createElement('figure');
  box.className = 'vc-bar-chart';
  box.innerHTML = `<style>
    .vc-bar-chart { margin: 0; height: 100%; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
    .vc-bar-chart figcaption { font-weight: 650; }
    .vc-bar-chart .bars { flex: 1; display: flex; align-items: flex-end; gap: 4px; min-height: 0; border-bottom: 1px solid var(--border, #ccc); }
    .vc-bar-chart .bar { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; height: 100%; min-width: 0; }
    .vc-bar-chart .fill { width: 100%; max-width: 48px; border-radius: 4px 4px 0 0; background: var(--accent, #2563eb); }
    .vc-bar-chart .fill.negative { background: var(--danger, #dc2626); }
    .vc-bar-chart .value { color: var(--text-muted, #666); white-space: nowrap; }
    .vc-bar-chart .names { display: flex; gap: 4px; }
    .vc-bar-chart .names span { flex: 1; min-width: 0; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted, #666); }
    .vc-bar-chart .empty { margin: auto; color: var(--text-muted, #666); }
  </style>`;
  if (title) {
    const caption = document.createElement('figcaption');
    caption.textContent = title;
    box.append(caption);
  }
  const k = table ? table.columns.findIndex((h) => same(h, column)) : -1;
  const n = table ? Math.max(0, table.columns.findIndex((h) => same(h, labelColumn))) : 0;
  const points = k < 0 ? [] : table.rows
    .map((r) => ({ name: r[n] ?? '', text: r[k] ?? '', value: parseNumber(r[k] ?? '') }))
    .filter((p) => p.value !== undefined);
  if (points.length === 0) {
    box.insertAdjacentHTML('beforeend', '<p class="empty"></p>');
    box.querySelector('.empty').textContent = column ? `No numbers in a “${column}” column on this screen` : 'Set the "column" option';
    element.append(box);
    return;
  }
  const max = Math.max(...points.map((p) => Math.abs(p.value)), 1);
  const bars = document.createElement('div');
  bars.className = 'bars';
  bars.setAttribute('role', 'img');
  bars.setAttribute('aria-label', `${column}: ` + points.map((p) => `${p.name} ${p.text}`).join(', '));
  const names = document.createElement('div');
  names.className = 'names';
  for (const p of points) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.title = `${p.name}: ${p.text}`;
    const value = document.createElement('span');
    value.className = 'value';
    value.textContent = p.text;
    const fill = document.createElement('div');
    fill.className = `fill${p.value < 0 ? ' negative' : ''}`;
    fill.style.height = `calc(${(Math.abs(p.value) / max) * 100}% - 16px)`;
    bar.append(value, fill);
    bars.append(bar);
    const name = document.createElement('span');
    name.textContent = p.name;
    names.append(name);
  }
  box.append(bars, names);
  element.append(box);
}

export function mount(element, ctx) {
  draw(element, ctx);
  return { update: (next) => draw(element, next) };
}
