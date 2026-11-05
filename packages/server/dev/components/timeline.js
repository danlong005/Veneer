// Veneer component: a status as steps, e.g. Ordered → Picked → Shipped →
// Delivered, with the current one highlighted.
//
// Place it in a box near the status (Page tab ▸ Components ▸ Status
// timeline), and hide the status text if the timeline replaces it. Options:
//   steps     required: the steps in order, as the host's values
//             (["ORD", "PCK", "SHP", "DLV"]) or with labels:
//             [{ "value": "ORD", "label": "Ordered" }, …]. A step can match
//             several values: { "value": ["SHP", "INT"], "label": "Shipped" }
//   at        where the status is: "6:20" is the field there (as typed) or
//             the text up to a double space; "6:20:3" exactly 3 characters.
//             Not needed when the component is put on the status field itself
//   stopped   values that end it early, e.g. [{ "value": "CAN", "label":
//             "Cancelled" }]: the steps show up to the last one reached
//             (`after`, a step's value, if given) with the stop marked
//   direction "across" (default) or "down"
//
// Values match ignoring case and spaces at the ends. A status that matches
// no step shows the steps with none current, and the status beside them.

export const label = 'Status timeline';

const POSITION = /^(\d{1,3}):(\d{1,3})(?::(\d{1,3}))?$/;

const stepList = (raw, name, s) => {
  if (raw === undefined) return [];
  const ok = Array.isArray(raw) && raw.every((x) => typeof x === 'string' || (x && typeof x === 'object' && (typeof x.value === 'string' || (Array.isArray(x.value) && x.value.every((v) => typeof v === 'string')))));
  if (!ok) {
    s.error ||= `"${name}" must be a list of values, or of { "value", "label" }`;
    return [];
  }
  return raw.map((x) => {
    if (typeof x === 'string') return { values: [x.trim()], label: x.trim() };
    const values = (Array.isArray(x.value) ? x.value : [x.value]).map((v) => v.trim());
    return { values, label: typeof x.label === 'string' && x.label.trim() ? x.label.trim() : values[0], after: typeof x.after === 'string' ? x.after.trim() : '' };
  });
};

/** The options, checked; `error` says what is wrong. */
export function settings(options = {}) {
  const o = options && typeof options === 'object' ? options : {};
  const s = { at: null, direction: o.direction === undefined ? 'across' : String(o.direction).trim().toLowerCase(), error: '' };
  s.steps = stepList(o.steps, 'steps', s);
  s.stopped = stepList(o.stopped, 'stopped', s);
  if (s.steps.length === 0) s.error ||= 'Set "steps" to the statuses in order, e.g. ["Ordered", "Shipped", "Delivered"]';
  if (o.at !== undefined) {
    const m = POSITION.exec(String(o.at).trim());
    if (m) s.at = { row: Number(m[1]), col: Number(m[2]), length: m[3] ? Number(m[3]) : undefined };
    else s.error ||= '"at" must be a position, such as "6:20" or "6:20:3"';
  }
  if (s.direction !== 'across' && s.direction !== 'down') s.error ||= '"direction" must be "across" or "down"';
  return s;
}

/** The status: the bound field's value, else the text at `at`. */
export function statusOf(ctx, s) {
  if (ctx.field) return (ctx.value ?? '').trim();
  if (!s.at) return '';
  const { row, col, length } = s.at;
  const field = ctx.screen.fields.find((f) => f.row === row && f.col === col);
  if (field) {
    const v = ctx.getField?.(field.id) ?? field.value;
    return (length ? v.slice(0, length) : v).trim();
  }
  const rest = (ctx.screen.lines[row - 1] ?? '').slice(col - 1);
  return (length ? rest.slice(0, length) : rest.split('  ')[0]).trim();
}

const is = (step, value) => step.values.some((v) => v.toLowerCase() === value.toLowerCase());

/**
 * Where the status is: { current } (a step's index), { stopped, reached } (a
 * stop, after step `reached`, -1 for none), or { unknown } (matches nothing).
 */
export function progressOf(s, value) {
  const i = s.steps.findIndex((st) => is(st, value));
  if (i >= 0) return { current: i };
  const stop = s.stopped.find((st) => is(st, value));
  if (stop) return { stopped: stop, reached: stop.after ? s.steps.findIndex((st) => is(st, stop.after)) : -1 };
  return { unknown: value };
}

const CSS = `
.vc-timeline { height: 100%; display: flex; align-items: center; font-size: 12px; min-height: 0; overflow: auto; }
.vc-timeline ol { display: flex; flex: 1; margin: 0; padding: 0; list-style: none; gap: 0; }
.vc-timeline.vc-down ol { flex-direction: column; align-self: stretch; }
.vc-timeline li { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; position: relative; min-width: 0; text-align: center; color: var(--text-muted, #666); }
.vc-timeline.vc-down li { flex-direction: row; text-align: left; gap: 8px; padding: 2px 0; }
.vc-timeline li::before { content: ''; position: absolute; top: 9px; right: 50%; width: 100%; height: 2px; background: var(--border, #d4d4d8); z-index: 0; }
.vc-timeline.vc-down li::before { top: auto; bottom: 50%; right: auto; left: 9px; width: 2px; height: 100%; }
.vc-timeline li:first-child::before { display: none; }
.vc-timeline .vc-dot { width: 20px; height: 20px; border-radius: 50%; flex: none; display: grid; place-items: center; z-index: 1; font-size: 11px; font-weight: 700;
  border: 2px solid var(--border, #d4d4d8); background: var(--surface, #fff); color: var(--text-muted, #666); }
.vc-timeline li span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.vc-timeline li.vc-done, .vc-timeline li.vc-now { color: var(--text, inherit); }
.vc-timeline li.vc-done::before, .vc-timeline li.vc-now::before { background: var(--accent, #2563eb); }
.vc-timeline li.vc-done .vc-dot { background: var(--accent, #2563eb); border-color: var(--accent, #2563eb); color: #fff; }
.vc-timeline li.vc-now .vc-dot { border-color: var(--accent, #2563eb); box-shadow: 0 0 0 3px var(--accent-soft, #dbe7ff); }
.vc-timeline li.vc-now span:last-child { font-weight: 650; }
.vc-timeline li.vc-stop { color: var(--danger, #dc2626); }
.vc-timeline li.vc-stop .vc-dot { border-color: var(--danger, #dc2626); background: var(--danger, #dc2626); color: #fff; }
.vc-timeline .vc-other { margin-left: 10px; color: var(--text-muted, #666); white-space: nowrap; }
`;

export function mount(element, ctx) {
  const doc = element.ownerDocument;
  const root = doc.createElement('div');
  element.append(root);
  let current = ctx;
  let drawn = null;

  const draw = () => {
    const s = settings(current.options);
    const value = s.error ? '' : statusOf(current, s);
    const key = JSON.stringify([s, value]);
    if (key === drawn) return;
    drawn = key;
    root.className = `vc-timeline${s.direction === 'down' ? ' vc-down' : ''}`;
    const style = doc.createElement('style');
    style.textContent = CSS;
    if (s.error) {
      const p = doc.createElement('p');
      p.textContent = `Status timeline: ${s.error}`;
      return root.replaceChildren(style, p);
    }
    const where = progressOf(s, value);
    const ol = doc.createElement('ol');
    const steps = where.stopped ? [...s.steps.slice(0, where.reached + 1).map((st) => ({ st, kind: 'done' })), { st: where.stopped, kind: 'stop' }]
      : s.steps.map((st, i) => ({ st, kind: where.current === undefined ? 'todo' : i < where.current ? 'done' : i === where.current ? 'now' : 'todo' }));
    const word = { done: 'done', now: 'current', todo: 'not yet', stop: 'stopped' };
    steps.forEach(({ st, kind }, i) => {
      const li = doc.createElement('li');
      li.className = { done: 'vc-done', now: 'vc-now', todo: '', stop: 'vc-stop' }[kind];
      if (kind === 'now' || kind === 'stop') li.setAttribute('aria-current', 'step');
      const dot = doc.createElement('span');
      dot.className = 'vc-dot';
      dot.setAttribute('aria-hidden', 'true');
      dot.textContent = kind === 'done' ? '✓' : kind === 'stop' ? '✕' : String(i + 1);
      const name = doc.createElement('span');
      name.textContent = st.label;
      li.setAttribute('aria-label', `${st.label}: ${word[kind]}`);
      li.title = st.label;
      li.append(dot, name);
      ol.append(li);
    });
    ol.setAttribute('aria-label', `Status: ${where.stopped?.label ?? s.steps[where.current]?.label ?? (value || 'none')}`);
    const parts = [style, ol];
    if (where.unknown !== undefined && value) {
      const other = doc.createElement('span');
      other.className = 'vc-other';
      other.textContent = `Status: ${value}`;
      parts.push(other);
    }
    root.replaceChildren(...parts);
  };

  draw();
  return {
    update(next) {
      current = next;
      draw();
    },
    unmount() {
      root.remove();
    },
  };
}
