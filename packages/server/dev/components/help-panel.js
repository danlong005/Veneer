// Veneer component: help for a screen, written in Markdown, in a panel that
// opens from an ⓘ button or the F1 key, alongside or in place of the host's
// own help.
//
// Place it where the button should be (Page tab ▸ Components ▸ Help panel),
// one character high is enough. Options:
//   markdown  the help (required): a string, or a list of lines. Headings
//             (#, ##, ###), paragraphs, lists (- or 1.), **bold**, *italic*,
//             `code`, ``` code blocks ```, > quotes and [links](https://…)
//   title     the panel's heading; default "Help"
//   key       the key that opens it: "F1" (default), another F-key such as
//             "F24", or "" for the button only
//   host      "replace" (default): the key opens this panel instead of the
//             host's help; "alongside": the panel has a Host help button too
//   label     the button's text; default "Help"
//
// Markdown is drawn as text, never as HTML, so help can't run scripts; links
// go only to http(s) and mailto addresses, in a new tab. Esc closes the panel.

export const label = 'Help panel';

const KEY = /^F([1-9]|1\d|2[0-4])$/;

/** The options, checked; `error` says what is wrong. */
export function settings(options = {}) {
  const o = options && typeof options === 'object' ? options : {};
  const md = Array.isArray(o.markdown) ? o.markdown.filter((l) => typeof l === 'string').join('\n') : typeof o.markdown === 'string' ? o.markdown : '';
  const s = {
    markdown: md,
    title: typeof o.title === 'string' && o.title.trim() ? o.title.trim() : 'Help',
    label: typeof o.label === 'string' && o.label.trim() ? o.label.trim() : 'Help',
    key: o.key === undefined ? 'F1' : String(o.key).trim().toUpperCase(),
    host: o.host === undefined ? 'replace' : String(o.host).trim().toLowerCase(),
    error: '',
  };
  if (!md.trim()) s.error = 'Set "markdown" to the help text';
  if (s.key && !KEY.test(s.key)) s.error ||= '"key" must be F1 to F24, or "" for the button only';
  if (s.host !== 'replace' && s.host !== 'alongside') s.error ||= '"host" must be "replace" or "alongside"';
  return s;
}

/** A link's address if it's safe to open: http(s) or mailto. */
export function safeHref(href) {
  try {
    const u = new URL(href, 'https://invalid.example/');
    if (u.origin === 'https://invalid.example') return null; // relative: no base to resolve against
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Inline Markdown as a list of pieces: text, and { strong | em | code | link }.
 * `**bold**`, `*italic*` or `_italic_`, `` `code` ``, `[text](url)`.
 */
export function inline(textIn) {
  const out = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let at = 0;
  let m;
  while ((m = re.exec(textIn))) {
    if (m.index > at) out.push(textIn.slice(at, m.index));
    if (m[1] !== undefined) out.push({ code: m[1] });
    else if (m[2] !== undefined) out.push({ strong: inline(m[2]) });
    else if (m[3] !== undefined || m[4] !== undefined) out.push({ em: inline(m[3] ?? m[4]) });
    else {
      const href = safeHref(m[6]);
      out.push(href ? { link: inline(m[5]), href } : m[0]);
    }
    at = re.lastIndex;
  }
  if (at < textIn.length) out.push(textIn.slice(at));
  return out;
}

/**
 * Markdown as blocks: { h, level, text } | { p, text } | { ul | ol, items }
 * | { pre, text } | { quote, text }. `text` is inline pieces.
 */
export function blocks(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if (/^\s*```/.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push({ pre: body.join('\n') });
    } else if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      out.push({ h: true, level: m[1].length, text: inline(m[2].trim()) });
      i++;
    } else if (/^\s*([-*+])\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      const item = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      while (i < lines.length && item.test(lines[i])) {
        let t = item.exec(lines[i])[1];
        i++;
        // Indented lines carry on the item.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !item.test(lines[i])) t += ` ${lines[i++].trim()}`;
        items.push(inline(t));
      }
      out.push(ordered ? { ol: true, items } : { ul: true, items });
    } else if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push({ quote: true, text: inline(body.join(' ')) });
    } else {
      const body = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,3})\s|^\s*```|^\s*([-*+]|\d+[.)])\s+|^\s*>/.test(lines[i])) body.push(lines[i++].trim());
      out.push({ p: true, text: inline(body.join(' ')) });
    }
  }
  return out;
}

/** Draw blocks as DOM nodes: only text nodes and a fixed set of elements. */
export function render(doc, list) {
  const pieces = (parent, parts) => {
    for (const p of parts) {
      if (typeof p === 'string') parent.append(doc.createTextNode(p));
      else if (p.code !== undefined) { const c = doc.createElement('code'); c.textContent = p.code; parent.append(c); }
      else if (p.strong) { const b = doc.createElement('strong'); pieces(b, p.strong); parent.append(b); }
      else if (p.em) { const e = doc.createElement('em'); pieces(e, p.em); parent.append(e); }
      else if (p.link) {
        const a = doc.createElement('a');
        a.href = p.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        pieces(a, p.link);
        parent.append(a);
      }
    }
    return parent;
  };
  const frag = doc.createDocumentFragment();
  for (const b of list) {
    if (b.h) frag.append(pieces(doc.createElement(`h${b.level + 2}`), b.text));
    else if (b.p) frag.append(pieces(doc.createElement('p'), b.text));
    else if (b.quote) frag.append(pieces(doc.createElement('blockquote'), b.text));
    else if (b.pre !== undefined) { const pre = doc.createElement('pre'); pre.textContent = b.pre; frag.append(pre); }
    else {
      const l = doc.createElement(b.ol ? 'ol' : 'ul');
      for (const item of b.items) l.append(pieces(doc.createElement('li'), item));
      frag.append(l);
    }
  }
  return frag;
}

const CSS = `
.vc-help-button { height: 100%; display: flex; align-items: center; }
.vc-help-button button { display: inline-flex; align-items: center; gap: 4px; font: inherit; font-size: 0.9em; padding: 0 8px; height: 100%; max-height: 28px;
  border-radius: 999px; cursor: pointer; border: 1px solid var(--border, #ccc); background: var(--surface-2, #f4f4f5); color: var(--text, inherit); }
.vc-help-button button:hover { border-color: var(--accent, #2563eb); }
.vc-help-button kbd { font: inherit; font-size: 0.85em; color: var(--text-muted, #666); }
.vc-help-panel { position: fixed; z-index: 50; top: 0; right: 0; bottom: 0; width: min(420px, 92vw); display: flex; flex-direction: column;
  background: var(--surface, #fff); color: var(--text, inherit); border-left: 1px solid var(--border, #ccc); box-shadow: -8px 0 24px rgb(0 0 0 / 15%);
  font-size: 14px; line-height: 1.5; }
.vc-help-panel header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border, #e5e7eb); }
.vc-help-panel header h2 { margin: 0 auto 0 0; font-size: 1.1em; }
.vc-help-panel header button { font: inherit; font-size: 0.9em; padding: 2px 8px; border-radius: 6px; cursor: pointer; border: 1px solid var(--border, #ccc);
  background: var(--surface-2, #f4f4f5); color: var(--text, inherit); }
.vc-help-panel .vc-help-body { flex: 1; overflow: auto; padding: 4px 16px 16px; }
.vc-help-panel .vc-help-body:focus-visible { outline: 2px solid var(--focus, var(--accent, #2563eb)); outline-offset: -2px; }
.vc-help-panel h3, .vc-help-panel h4, .vc-help-panel h5 { margin: 1em 0 0.3em; }
.vc-help-panel code, .vc-help-panel pre { font-family: var(--mono, monospace); font-size: 0.9em; background: var(--surface-2, #f4f4f5); border-radius: 4px; }
.vc-help-panel code { padding: 0 3px; }
.vc-help-panel pre { padding: 6px 8px; overflow: auto; }
.vc-help-panel blockquote { margin: 0.6em 0; padding: 2px 10px; border-left: 3px solid var(--accent, #2563eb); color: var(--text-muted, #555); }
.vc-help-panel a { color: var(--accent, #2563eb); }
`;

export function mount(element, ctx) {
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  let current = ctx;
  let s = settings(ctx.options);
  const root = doc.createElement('div');
  root.className = 'vc-help-button';
  element.append(root);
  let panel = null;

  const close = () => {
    if (!panel) return;
    panel.remove();
    panel = null;
    root.querySelector('button')?.setAttribute('aria-expanded', 'false');
    root.querySelector('button')?.focus();
  };
  const open = () => {
    if (s.error) return;
    if (panel) { panel.querySelector('.vc-help-body')?.focus(); return; }
    panel = doc.createElement('aside');
    panel.className = 'vc-help-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    const id = `vc-help-${Math.random().toString(36).slice(2, 8)}`;
    panel.setAttribute('aria-labelledby', id);
    const style = doc.createElement('style');
    style.textContent = CSS;
    const header = doc.createElement('header');
    const h = doc.createElement('h2');
    h.id = id;
    h.textContent = s.title;
    header.append(h);
    if (s.host === 'alongside' && !current.design) {
      const hostHelp = doc.createElement('button');
      hostHelp.type = 'button';
      hostHelp.textContent = 'Host help';
      hostHelp.title = 'The host\'s own help for this screen';
      hostHelp.addEventListener('click', () => {
        close();
        current.press(current.screen?.host === '3270' ? 'F1' : 'Help');
      });
      header.append(hostHelp);
    }
    const x = doc.createElement('button');
    x.type = 'button';
    x.textContent = 'Close (Esc)';
    x.addEventListener('click', close);
    header.append(x);
    const body = doc.createElement('div');
    body.className = 'vc-help-body';
    body.tabIndex = 0;
    body.append(render(doc, blocks(s.markdown)));
    panel.append(style, header, body);
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    doc.body.append(panel);
    root.querySelector('button')?.setAttribute('aria-expanded', 'true');
    body.focus();
  };

  // The key: caught before Veneer sends it to the host.
  const onKey = (e) => {
    if (!s.key || s.error || e.key !== s.key || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    // Keys typed in Veneer's own dialogs, the designer's panels and other panels are theirs.
    if (e.target instanceof win.Element && e.target.closest('.overlay, .design-panel, .macros-panel')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (panel) close();
    else open();
  };
  win.addEventListener('keydown', onKey, true);

  const draw = () => {
    const style = doc.createElement('style');
    style.textContent = CSS;
    const b = doc.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-expanded', String(!!panel));
    b.title = s.error ? `Help panel: ${s.error}` : s.title;
    b.append(doc.createTextNode(`ⓘ ${s.label}`));
    if (s.key && !s.error) {
      const k = doc.createElement('kbd');
      k.textContent = s.key;
      b.append(k);
    }
    b.addEventListener('click', () => (panel ? close() : open()));
    root.replaceChildren(style, b);
  };

  draw();
  return {
    update(next) {
      current = next;
      const again = settings(next.options);
      if (JSON.stringify(again) !== JSON.stringify(s)) {
        s = again;
        if (panel) { close(); open(); }
        draw();
      }
    },
    unmount() {
      win.removeEventListener('keydown', onKey, true);
      if (panel) panel.remove();
      panel = null;
      root.remove();
    },
  };
}
