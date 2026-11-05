// Veneer component: a page from another system in a frame, its address built
// from the screen, e.g. a product page or a document for the order showing.
//
// Place it in a box (Page tab ▸ Components ▸ Embedded page). Options:
//   url       required: the page's address, with screen values in braces:
//             "https://docs.example.com/orders/{4:20}" puts in the field (or
//             text) at row 4, column 20; "{4:20:10}" takes exactly 10
//             characters. Values are trimmed and URL-encoded.
//   title     what the frame shows, for screen readers and the caption
//   caption   true shows the title above the frame
//   link      false hides the "Open in a new tab" link
//   sandbox   the frame's sandbox; default "allow-scripts allow-same-origin
//             allow-popups allow-forms"
//
// Only https:// pages are shown (http:// only on this machine). The other
// site must allow being framed (no X-Frame-Options: DENY, or a
// frame-ancestors that includes this site); if it doesn't, the browser shows
// an error in the frame, and the link still opens it. In the designer the
// page isn't loaded, so screen values aren't sent, until "Show page".
// While a value is blank the frame waits, saying which one.

export const label = 'Embedded page';

export const DEFAULTS = Object.freeze({ sandbox: 'allow-scripts allow-same-origin allow-popups allow-forms' });
/** How long the address must stay the same before the frame loads it, in ms. */
export const SETTLE_MS = 400;

const PLACEHOLDER = /\{(\d{1,3}):(\d{1,3})(?::(\d{1,3}))?\}/g;

/** The options, checked; `error` says what is wrong. */
export function settings(options = {}) {
  const o = options && typeof options === 'object' ? options : {};
  const s = {
    url: typeof o.url === 'string' ? o.url.trim() : '',
    title: typeof o.title === 'string' && o.title.trim() ? o.title.trim() : 'Embedded page',
    caption: o.caption === true,
    link: o.link !== false,
    sandbox: typeof o.sandbox === 'string' ? o.sandbox.trim().replace(/\s+/g, ' ') : DEFAULTS.sandbox,
    error: '',
  };
  if (!s.url) s.error = 'Set "url" to the page\'s address, e.g. "https://example.com/orders/{4:20}"';
  else if (!allowed(s.url.replace(PLACEHOLDER, 'x'))) s.error = 'The address must start with https://';
  if (s.sandbox && !/^[a-z-]+( [a-z-]+)*$/.test(s.sandbox)) s.error ||= '"sandbox" must be sandbox keywords, such as "allow-scripts"';
  return s;
}

/** https, or http on this machine. */
export function allowed(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

/** The text at a screen position: the field starting there (as typed), else the text up to a double space. */
export function readPosition(ctx, row, col, length) {
  const field = ctx.screen.fields.find((f) => f.row === row && f.col === col);
  if (field) {
    const value = ctx.getField?.(field.id) ?? field.value;
    return (length ? value.slice(0, length) : value).trim();
  }
  const rest = (ctx.screen.lines[row - 1] ?? '').slice(col - 1);
  return (length ? rest.slice(0, length) : rest.split('  ')[0]).trim();
}

/**
 * The address with the screen's values: { url } or { blank: "4:20" } naming
 * the first position that is blank (the page waits for it).
 */
export function fillUrl(ctx, template) {
  let blank = null;
  const url = template.replace(PLACEHOLDER, (_m, r, c, l) => {
    const v = readPosition(ctx, Number(r), Number(c), l ? Number(l) : undefined);
    if (!v && !blank) blank = `${r}:${c}`;
    return encodeURIComponent(v);
  });
  if (blank) return { blank };
  return allowed(url) ? { url } : { error: 'The address isn\'t a valid https:// address once filled in' };
}

const CSS = `
.vc-embed { margin: 0; height: 100%; display: flex; flex-direction: column; gap: 4px; font-size: 12px; min-height: 0; }
.vc-embed figcaption { font-weight: 650; }
.vc-embed iframe { flex: 1; width: 100%; min-height: 0; border: 1px solid var(--border, #ccc); border-radius: 4px; background: var(--surface, #fff); }
.vc-embed .vc-embed-note { margin: auto; padding: 0 8px; text-align: center; color: var(--text-muted, #666); }
.vc-embed .vc-embed-note button { margin-top: 6px; }
.vc-embed a { align-self: flex-end; color: var(--accent, #2563eb); }
`;

export function mount(element, ctx) {
  const doc = element.ownerDocument;
  let current = ctx;
  let drawn = null;
  let timer = null;
  let preview = false;
  const root = doc.createElement('figure');
  root.className = 'vc-embed';
  element.append(root);
  const el = (tag, className, text) => {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  const stateOf = (c) => {
    const s = settings(c.options);
    const filled = s.error ? {} : fillUrl(c, s.url);
    return { s, filled, hidden: Boolean(c.design) && !preview, key: JSON.stringify([s, filled, Boolean(c.design) && !preview]) };
  };

  const draw = () => {
    timer = null;
    const { s, filled, hidden, key } = stateOf(current);
    if (key === drawn) return;
    drawn = key;
    const style = el('style');
    style.textContent = CSS;
    const head = s.caption ? [el('figcaption', '', s.title)] : [];
    const note = (text, ...more) => {
      const p = el('p', 'vc-embed-note', text);
      p.setAttribute('role', 'status');
      p.append(...more);
      root.replaceChildren(style, ...head, p);
    };
    if (s.error) return note(`Embedded page: ${s.error}`);
    if (filled.error) return note(filled.error);
    if (filled.blank) return note(`Nothing to show until ${filled.blank} has a value.`);
    if (hidden) {
      const b = el('button', '', 'Show page');
      b.type = 'button';
      b.addEventListener('click', () => { preview = true; draw(); });
      return note(`${filled.url}. The page isn't loaded while designing, so the screen's values aren't sent until you ask.`, el('br'), b);
    }
    const frame = el('iframe');
    // The sandbox goes on before the address, so the page never loads without it.
    if (s.sandbox) frame.setAttribute('sandbox', s.sandbox);
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    frame.setAttribute('loading', 'lazy');
    frame.title = s.title;
    frame.src = filled.url;
    const parts = [style, ...head, frame];
    if (s.link) {
      const a = el('a', '', 'Open in a new tab');
      a.href = filled.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      parts.push(a);
    }
    root.replaceChildren(...parts);
  };

  draw();
  return {
    update(next) {
      current = next;
      if (timer !== null) clearTimeout(timer);
      timer = stateOf(next).key === drawn ? null : setTimeout(draw, SETTLE_MS);
    },
    unmount() {
      if (timer !== null) clearTimeout(timer);
      root.remove();
    },
  };
}
