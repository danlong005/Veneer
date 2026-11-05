// Veneer component: every row of a customer or delivery list as a pin on one
// map. Needs map.js (its address lookup) and lib/lists.js beside it.
//
// Place it beside or over the list (Page tab ▸ Components ▸ Pin map).
// Options (columns are found by their heading, ignoring case):
//   address   required: the columns that make up each row's address, in
//             order, e.g. ["Street", "City", "State", "Zip"]; or one template
//             with headings in braces: "{City}, {State} {Zip}"
//   suffix    text added to every address, e.g. "USA"
//   label     the column naming each pin; default the first column
//   default   the list option the pin's button runs, e.g. "5"
//   list      "all" (default) reads the whole list, as Export does; "page"
//             shows the page showing
//   maxPins   look up at most this many addresses; default 50
//   geocoder  a Nominatim-compatible search URL; default OpenStreetMap's
//   tiles     a map tile URL with {z}, {x} and {y}; default OpenStreetMap's
//   attribution  the credit shown for the tiles; default "© OpenStreetMap
//             contributors"
//
// Addresses leave the site: each goes to the geocoder, which is asked for one
// a second (OpenStreetMap's usage policy), so a long list fills in over time.
// Each address is looked up once per browser session. In the designer nothing
// is sent until the designer clicks "Show map".
//
// Drag to move the map; the + and − buttons zoom. Each pin is a button
// (Tab reaches them in list order): it shows the row's name and address, and
// the default option's button.

import { DEFAULTS as MAP_DEFAULTS, geocode } from './map.js';
import { BASE_CSS, columnIndex, defaultAction, listFeed, listScope, maker, pagesOption, text } from './lib/lists.js';

export const label = 'Pin map';

export const DEFAULTS = Object.freeze({
  maxPins: 50,
  tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '© OpenStreetMap contributors',
  geocoder: MAP_DEFAULTS.geocoder,
});
/** Between lookups, in ms: Nominatim asks for at most one a second. */
export const LOOKUP_MS = 1100;
const TILE = 256;

const httpsUrl = (t) => {
  try {
    const u = new URL(t.replace(/\{[xyz]\}/g, '0'));
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname));
  } catch {
    return false;
  }
};

/** The options, checked; `error` says what is wrong. */
export function settings(options = {}) {
  const o = options && typeof options === 'object' ? options : {};
  const s = { suffix: text(o.suffix), label: text(o.label), error: '' };
  s.default = o.default === undefined || o.default === null ? '' : String(o.default).trim();
  if (typeof o.address === 'string' && o.address.trim()) s.address = { template: o.address.trim() };
  else if (Array.isArray(o.address) && o.address.length && o.address.every((a) => typeof a === 'string')) s.address = { columns: o.address.map((a) => a.trim()).filter(Boolean) };
  else s.error = 'Set "address" to the columns of each row\'s address, e.g. ["Street", "City", "State", "Zip"]';
  const scope = listScope(o);
  s.list = scope.scope;
  s.error ||= scope.error;
  pagesOption(o, s);
  s.maxPins = DEFAULTS.maxPins;
  if (o.maxPins !== undefined) {
    const n = Math.round(Number(o.maxPins));
    if (n >= 1) s.maxPins = Math.min(n, 500);
    else s.error ||= '"maxPins" must be a number';
  }
  s.geocoder = text(o.geocoder) || DEFAULTS.geocoder;
  s.tiles = text(o.tiles) || DEFAULTS.tiles;
  s.attribution = typeof o.attribution === 'string' ? o.attribution.trim() : DEFAULTS.attribution;
  if (!httpsUrl(s.geocoder)) s.error ||= `The geocoder must be an https:// address (got "${s.geocoder}")`;
  if (!httpsUrl(s.tiles) || !/\{z\}/.test(s.tiles) || !/\{x\}/.test(s.tiles) || !/\{y\}/.test(s.tiles)) s.error ||= '"tiles" must be an https:// address with {z}, {x} and {y}';
  return s;
}

/** The headings an address needs (to find the list). */
export function addressHeadings(s) {
  if (!s.address) return [];
  return s.address.columns ?? [...s.address.template.matchAll(/\{([^}]+)\}/g)].map((m) => m[1].trim());
}

/** A row's address as one line, or '' when its address columns are blank. */
export function addressOf(list, record, s) {
  const cell = (h) => {
    const k = columnIndex(list.columns, h);
    return k < 0 ? '' : (record.cells[k] ?? '').trim();
  };
  let line;
  if (s.address.columns) {
    const parts = s.address.columns.map(cell).filter(Boolean);
    if (!parts.length) return '';
    line = parts.join(', ');
  } else {
    let found = false;
    line = s.address.template.replace(/\{([^}]+)\}/g, (_m, h) => { const v = cell(h); if (v) found = true; return v; });
    if (!found) return '';
  }
  line = line.replace(/\s+/g, ' ').replace(/(,\s*)+/g, ', ').replace(/^[\s,]+|[\s,]+$/g, '');
  return s.suffix ? `${line}, ${s.suffix}` : line;
}

/** Web Mercator: a place's pixel position at zoom z. */
export function project(lat, lon, z) {
  const scale = TILE * 2 ** z;
  const sin = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
}

/** The view that fits every place in w × h pixels (with a margin): { z, cx, cy }, the center in pixels at z. */
export function fitView(places, w, h, margin = 30) {
  const at = (lat, lon, z) => { const p = project(lat, lon, z); return { z, cx: p.x, cy: p.y }; };
  if (places.length === 0) return at(20, 0, 2);
  if (places.length === 1) return at(places[0].lat, places[0].lon, 14);
  for (let z = 16; z >= 1; z--) {
    const pts = places.map((p) => project(p.lat, p.lon, z));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if ((x1 - x0 <= w - 2 * margin && y1 - y0 <= h - 2 * margin) || z === 1) return { z, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }
  return at(0, 0, 1);
}

/** The tiles that cover a w × h view centered on (cx, cy) at zoom z: [{ x, y, left, top, url }]. */
export function tilesFor(view, w, h, template) {
  const n = 2 ** view.z;
  const x0 = Math.floor((view.cx - w / 2) / TILE);
  const y0 = Math.max(0, Math.floor((view.cy - h / 2) / TILE));
  const x1 = Math.floor((view.cx + w / 2 - 1) / TILE);
  const y1 = Math.min(n - 1, Math.floor((view.cy + h / 2 - 1) / TILE));
  const out = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const wrapped = ((tx % n) + n) % n;
      out.push({
        x: wrapped, y: ty,
        left: Math.round(tx * TILE - (view.cx - w / 2)), top: Math.round(ty * TILE - (view.cy - h / 2)),
        url: template.replace('{z}', String(view.z)).replace('{x}', String(wrapped)).replace('{y}', String(ty)),
      });
    }
  }
  return out;
}

/** Addresses found this browser session: kept so paging or reloading doesn't look them up again. */
const CACHE_KEY = 'veneer.pin-map.places';
function cached() {
  try { return JSON.parse(globalThis.sessionStorage?.getItem(CACHE_KEY) ?? '{}'); } catch { return {}; }
}
function remember(key, place) {
  try {
    const all = cached();
    all[key] = place;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - 1000))) delete all[k];
    globalThis.sessionStorage?.setItem(CACHE_KEY, JSON.stringify(all));
  } catch { /* storage full or off: look it up next time */ }
}

const CSS = `
.vc-pin-map { height: 100%; display: flex; flex-direction: column; gap: 4px; font-size: 12px; min-height: 0; }
.vc-pin-map .vc-pm-map { flex: 1; min-height: 0; position: relative; overflow: hidden; border: 1px solid var(--border, #ccc); border-radius: 6px;
  background: var(--surface-2, #e5e7eb); touch-action: none; cursor: grab; }
.vc-pin-map .vc-pm-map.vc-dragging { cursor: grabbing; }
.vc-pin-map .vc-pm-map img { position: absolute; width: 256px; height: 256px; user-select: none; -webkit-user-drag: none; pointer-events: none; }
.vc-pin-map .vc-pin { position: absolute; width: 22px; height: 22px; margin: -22px 0 0 -11px; padding: 0; border: 0; background: none; cursor: pointer; z-index: 1; }
.vc-pin-map .vc-pin svg { width: 22px; height: 22px; display: block; filter: drop-shadow(0 1px 1px rgb(0 0 0 / 40%)); }
.vc-pin-map .vc-pin path { fill: var(--accent, #2563eb); stroke: #fff; stroke-width: 1.5; }
.vc-pin-map .vc-pin.vc-on path { fill: var(--accent-2, #a1349b); }
.vc-pin-map .vc-pin:focus-visible { outline: 2px solid var(--focus, var(--accent, #2563eb)); outline-offset: 2px; border-radius: 50%; }
.vc-pin-map .vc-pm-pop { position: absolute; z-index: 3; transform: translate(-50%, calc(-100% - 28px)); min-width: 140px; max-width: 260px; padding: 6px 8px;
  border-radius: 6px; background: var(--surface, #fff); color: var(--text, inherit); border: 1px solid var(--border, #ccc); box-shadow: var(--shadow, 0 2px 8px rgb(0 0 0 / 20%)); cursor: auto; }
.vc-pin-map .vc-pm-pop b { display: block; }
.vc-pin-map .vc-pm-pop p { margin: 2px 0 4px; color: var(--text-muted, #666); white-space: normal; }
.vc-pin-map .vc-pm-zoom { position: absolute; z-index: 2; top: 6px; right: 6px; display: flex; flex-direction: column; gap: 2px; }
.vc-pin-map .vc-pm-zoom button { width: 26px; height: 26px; padding: 0; font-size: 16px; line-height: 1; background: var(--surface, #fff); }
.vc-pin-map .vc-pm-credit { position: absolute; z-index: 2; right: 0; bottom: 0; padding: 0 4px; font-size: 10px; background: rgb(255 255 255 / 75%); color: #333; }
.vc-pin-map .vc-pm-credit a { color: inherit; }
.vc-pin-map .vc-pm-note { margin: 0; color: var(--text-muted, #666); }
`;

const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-7.1 7-12.2A7 7 0 0 0 5 9.8C5 14.9 12 22 12 22z"/><circle cx="12" cy="9.8" r="2.6" fill="#fff"/></svg>';

export function mount(element, ctx) {
  const doc = element.ownerDocument;
  const make = maker(doc);
  const root = make('section', 'vc-list vc-pin-map');
  element.append(root);
  let current = ctx;
  let s = settings(ctx.options);
  let feed = null;
  /** In the designer: asked to see the map (addresses may then be sent). */
  let preview = false;
  /** Places found, by address: { lat, lon } or null (not found). */
  const places = new Map();
  let queue = [];
  let timer = null;
  let view = null;
  /** The user dragged or zoomed: keep their view as more pins come. */
  let moved = false;
  let chosen = null;
  let gone = false;

  const start = () => {
    feed?.stop();
    feed = null;
    view = null;
    moved = false;
    feed = s.error ? null : listFeed(current, {
      scope: s.list,
      headings: [...addressHeadings(s), s.label].filter(Boolean),
      maxPages: s.maxPages,
      onChange: () => { lookUp(); draw(); },
    });
  };

  /** Look up addresses not found yet, one at a time, a second apart. */
  function lookUp() {
    const { list } = feed?.state ?? {};
    if (!list || (current.design && !preview)) return;
    const store = cached();
    const wanted = [...new Set(list.records.map((r) => addressOf(list, r, s)).filter(Boolean))].slice(0, s.maxPins);
    for (const a of wanted) {
      const key = `${s.geocoder}\n${a}`;
      if (!places.has(a) && key in store) places.set(a, store[key]);
    }
    queue = wanted.filter((a) => !places.has(a));
    if (timer === null) next();
  }
  function next() {
    timer = null;
    const address = queue.shift();
    if (!address || gone) return;
    geocode(address, { geocoder: s.geocoder }).then(
      (place) => {
        places.set(address, place);
        remember(`${s.geocoder}\n${address}`, place);
      },
      () => { places.set(address, null); },
    ).finally(() => {
      if (gone) return;
      draw();
      timer = setTimeout(next, LOOKUP_MS);
    });
  }

  function draw() {
    const style = make('style');
    style.textContent = BASE_CSS + CSS;
    const message = (t, ...more) => {
      const p = make('p', 'vc-list-message', t);
      p.setAttribute('role', 'status');
      p.append(...more);
      root.replaceChildren(style, p);
    };
    if (s.error) return message(`Pin map: ${s.error}`);
    if (!feed) return;
    const { list, loading, error } = feed.state;
    if (!list) return message(loading ? 'Reading the list…' : error || 'No list on this screen');
    const pins = [];
    const seen = new Set();
    let blank = 0;
    const nameK = s.label ? columnIndex(list.columns, s.label) : 0;
    for (const r of list.records) {
      const address = addressOf(list, r, s);
      if (!address) { blank++; continue; }
      if (!seen.has(address) && seen.size >= s.maxPins) continue;
      seen.add(address);
      pins.push({ record: r, address, name: (r.cells[nameK] ?? '').trim(), place: places.get(address) });
    }
    if (current.design && !preview) {
      const b = make('button', '', 'Show map');
      b.type = 'button';
      b.addEventListener('click', () => { preview = true; lookUp(); draw(); });
      return message(`${pins.length} addresses. The map isn't loaded while designing, so no address is sent until you ask.`, b);
    }
    const found = pins.filter((p) => p.place);
    const missing = pins.filter((p) => p.place === null).length;
    const waiting = pins.filter((p) => p.place === undefined).length;

    const box = make('div', 'vc-pm-map');
    root.replaceChildren(style, box);
    const w = box.clientWidth || 400;
    const h = box.clientHeight || 250;
    // Until the user moves or zooms it, the map fits every pin found so far.
    if (!moved) view = fitView(found.map((p) => p.place), w, h);
    const v = view;

    for (const t of tilesFor(v, w, h, s.tiles)) {
      const img = make('img');
      img.alt = '';
      img.src = t.url;
      img.referrerPolicy = 'strict-origin-when-cross-origin';
      img.style.left = `${t.left}px`;
      img.style.top = `${t.top}px`;
      box.append(img);
    }
    const fallback = defaultAction(list, s.default);
    const at = (place) => { const p = project(place.lat, place.lon, v.z); return { left: p.x - (v.cx - w / 2), top: p.y - (v.cy - h / 2) }; };
    for (const p of found) {
      const { left, top } = at(p.place);
      const pin = make('button', `vc-pin${chosen === p.address ? ' vc-on' : ''}`);
      pin.type = 'button';
      pin.innerHTML = PIN;
      pin.style.left = `${left}px`;
      pin.style.top = `${top}px`;
      pin.setAttribute('aria-label', `${p.name}, ${p.address}`);
      pin.setAttribute('aria-expanded', String(chosen === p.address));
      pin.addEventListener('pointerdown', (e) => e.stopPropagation());
      pin.addEventListener('click', () => { chosen = chosen === p.address ? null : p.address; draw(); root.querySelector('.vc-pm-pop button, .vc-pin.vc-on')?.focus(); });
      box.append(pin);
      if (chosen === p.address) {
        const pop = make('div', 'vc-pm-pop');
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', p.name || p.address);
        pop.style.left = `${left}px`;
        pop.style.top = `${top}px`;
        pop.append(make('b', '', p.name || '—'), make('p', '', p.address));
        if (fallback && p.record.option) {
          const b = make('button', '', fallback.label);
          b.type = 'button';
          b.addEventListener('click', () => feed.run(p.record, fallback.value));
          pop.append(b);
        }
        pop.addEventListener('pointerdown', (e) => e.stopPropagation());
        pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); chosen = null; draw(); } });
        box.append(pop);
      }
    }
    const zoom = make('div', 'vc-pm-zoom');
    const zb = (label, by) => {
      const b = make('button', '', label);
      b.type = 'button';
      b.setAttribute('aria-label', by > 0 ? 'Zoom in' : 'Zoom out');
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', () => {
        const z = Math.min(18, Math.max(1, v.z + by));
        const f = 2 ** (z - v.z);
        view = { z, cx: v.cx * f, cy: v.cy * f };
        moved = true;
        draw();
        root.querySelector(`.vc-pm-zoom button[aria-label="${b.getAttribute('aria-label')}"]`)?.focus();
      });
      return b;
    };
    zoom.append(zb('+', 1), zb('−', -1));
    box.append(zoom);
    if (s.attribution) {
      const credit = make('div', 'vc-pm-credit');
      if (s.tiles === DEFAULTS.tiles) {
        const a = make('a', '', s.attribution);
        a.href = 'https://www.openstreetmap.org/copyright';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        credit.append(a);
      } else credit.textContent = s.attribution;
      box.append(credit);
    }
    // Drag to move.
    box.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const from = { x: e.clientX, y: e.clientY, cx: v.cx, cy: v.cy };
      box.setPointerCapture?.(e.pointerId);
      box.classList.add('vc-dragging');
      const moveTo = (ev) => {
        view = { z: v.z, cx: from.cx - (ev.clientX - from.x), cy: from.cy - (ev.clientY - from.y) };
        moved = true;
        const dx = Math.round(view.cx - v.cx);
        const dy = Math.round(view.cy - v.cy);
        for (const el of box.children) {
          if (el.classList.contains('vc-pm-zoom') || el.classList.contains('vc-pm-credit')) continue;
          el.style.transform = `translate(${-dx}px, ${-dy}px)${el.classList.contains('vc-pm-pop') ? ' translate(-50%, calc(-100% - 28px))' : ''}`;
        }
      };
      const end = () => {
        box.removeEventListener('pointermove', moveTo);
        box.classList.remove('vc-dragging');
        draw();
      };
      box.addEventListener('pointermove', moveTo);
      box.addEventListener('pointerup', end, { once: true });
      box.addEventListener('pointercancel', end, { once: true });
    });

    const notes = [];
    if (waiting) notes.push(`Finding ${waiting} more ${waiting === 1 ? 'address' : 'addresses'}…`);
    if (missing) notes.push(`${missing} ${missing === 1 ? 'address' : 'addresses'} couldn't be found.`);
    if (blank) notes.push(`${blank} ${blank === 1 ? 'row has' : 'rows have'} no address.`);
    if (seen.size >= s.maxPins && list.records.length > pins.length + blank) notes.push(`Only the first ${s.maxPins} addresses are shown.`);
    if (s.list === 'all' && !list.complete && !list.preview) notes.push(`Stopped after ${list.pages} pages.`);
    if (notes.length) {
      const p = make('p', 'vc-pm-note', notes.join(' '));
      p.setAttribute('role', 'status');
      root.append(p);
    }
  }

  start();
  lookUp();
  draw();
  return {
    update(next) {
      current = next;
      const again = settings(next.options);
      if (JSON.stringify(again) !== JSON.stringify(s)) {
        s = again;
        places.clear();
        start();
        lookUp();
        draw();
      } else feed?.update(next);
    },
    unmount() {
      gone = true;
      if (timer !== null) clearTimeout(timer);
      feed?.stop();
      root.remove();
    },
  };
}
