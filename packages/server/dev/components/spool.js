// Veneer component: a spool file (DSPSPLF, or option 5 on WRKSPLF; SDSF or
// ISPF BROWSE on a 3270) as one document to scroll, search and download,
// instead of a screen at a time.
//
// Place it over the report text (Page tab ▸ Components ▸ Spool file): its
// background covers the screen's text there. When the screen shows, it reads every page the way Export
// reads a list (to the top, down to "Bottom" or "BOTTOM OF DATA", and back),
// with the same progress and Cancel. Options:
//   from, to  the screen rows the report's text is on, e.g. 5 and 21. By
//             default, from the row after DSPSPLF's column ruler
//             ("*...+....1....+") to the row before "More..." or "Bottom"
//   title     a caption, and the downloaded file's name; default the spooled
//             file's name from the screen ("File . . . :   QSYSPRT")
//   read      "auto" (default) reads every page when the screen shows;
//             "button" waits for Read whole file
//   maxPages  stop after this many pages; default 300
//   wrap      true wraps long lines instead of scrolling sideways
//
// The text is as wide as the screen shows it: for a 132-column report, use a
// 27 × 132 session (or the host's own shift keys, F19/F20, then read again).
// Search finds text in the whole file: Enter (or ↓) goes to the next match,
// Shift+Enter (or ↑) to the one before. Download saves it as a .txt file.

export const label = 'Spool file';

export const DEFAULTS = Object.freeze({ maxPages: 300 });

/** DSPSPLF's column ruler: "*...+....1....+....2". */
const RULER = /^\s*\*\.\.\.\+\.\.\.\.1/;
/** The 5250 page marker: "More..." or "Bottom" at the end of a line. */
const MARKER = /(More\.\.\.|Bottom)\s*$/;

/** The options, checked; `error` says what is wrong. */
export function settings(options = {}) {
  const o = options && typeof options === 'object' ? options : {};
  const s = { title: typeof o.title === 'string' ? o.title.trim() : '', wrap: o.wrap === true, error: '' };
  const row = (name) => {
    if (o[name] === undefined) return null;
    const n = Number(o[name]);
    if (Number.isInteger(n) && n >= 1 && n <= 62) return n;
    s.error ||= `"${name}" must be a screen row, such as 5`;
    return null;
  };
  s.from = row('from');
  s.to = row('to');
  if (s.from && s.to && s.to < s.from) s.error ||= '"to" must not be above "from"';
  s.read = o.read === undefined ? 'auto' : String(o.read).trim().toLowerCase();
  if (s.read !== 'auto' && s.read !== 'button') s.error ||= '"read" must be "auto" or "button"';
  s.maxPages = DEFAULTS.maxPages;
  if (o.maxPages !== undefined) {
    const n = Math.round(Number(o.maxPages));
    if (n >= 1) s.maxPages = Math.min(n, 500);
    else s.error ||= '"maxPages" must be a number of pages';
  }
  return s;
}

/**
 * The rows the report is on: the options', else from the row after the
 * ruler to the row before the More.../Bottom marker. { from, to } or { error }.
 */
export function regionOf(lines, s) {
  const ruler = lines.findIndex((l) => RULER.test(l));
  let marker = -1;
  for (let i = lines.length - 1; i > Math.max(ruler, 0); i--) if (MARKER.test(lines[i]) && lines[i].trim().length < 40) { marker = i; break; }
  const from = s.from ?? (ruler >= 0 ? ruler + 2 : null);
  // Rows are 1-based; `marker` is 0-based, so the row before it is `marker`.
  const to = s.to ?? (marker >= 0 ? marker : null);
  if (!from || !to) return { error: 'Couldn\'t find the report text on this screen: set "from" and "to" to its first and last rows' };
  if (to < from) return { error: '"to" is above "from"' };
  return { from, to };
}

/** The spooled file's name from the screen ("File  . . . . :   QSYSPRT"), or ''. */
export function fileName(lines) {
  for (const l of lines) {
    const m = /\bFile\s*[. ]*:\s*(\S+)/i.exec(l);
    if (m) return m[1];
  }
  return '';
}

/** The pages as one text: lines without trailing blanks, and no blank lines at the end. */
export function documentOf(pages) {
  const lines = pages.flat().map((l) => l.replace(/\s+$/, ''));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Where `query` is in the lines, ignoring case: [{ line, start, end }]. */
export function findAll(lines, query) {
  const q = query.toLowerCase();
  if (!q) return [];
  const out = [];
  lines.forEach((l, line) => {
    const lower = l.toLowerCase();
    for (let at = lower.indexOf(q); at >= 0; at = lower.indexOf(q, at + q.length)) out.push({ line, start: at, end: at + q.length });
  });
  return out;
}

/** A name for the downloaded file: letters, digits, . _ - only. */
export const downloadName = (title) => `${(title || 'spool').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'spool'}.txt`;

const CSS = `
.vc-spool { height: 100%; display: flex; flex-direction: column; gap: 6px; font-size: 13px; min-height: 0; background: var(--surface, #fff); }
.vc-spool .vc-sp-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.vc-spool .vc-sp-bar strong { margin-right: auto; }
.vc-spool .vc-sp-bar input { font: inherit; padding: 2px 6px; border-radius: 6px; border: 1px solid var(--border, #ccc); background: var(--surface, #fff); color: var(--text, inherit); width: 14em; }
.vc-spool .vc-sp-count { color: var(--text-muted, #666); min-width: 5em; }
.vc-spool button { font: inherit; font-size: 0.9em; padding: 2px 8px; border-radius: 6px; cursor: pointer; border: 1px solid var(--border, #ccc);
  background: var(--surface-2, #f4f4f5); color: var(--text, inherit); }
.vc-spool button:hover:not(:disabled) { border-color: var(--accent, #2563eb); }
.vc-spool button:disabled { opacity: 0.5; cursor: default; }
.vc-spool pre { flex: 1; min-height: 0; margin: 0; overflow: auto; padding: 6px 8px; border: 1px solid var(--border, #ccc); border-radius: 6px;
  background: var(--surface, #fff); color: var(--text, inherit); font-family: var(--mono, monospace); font-size: 12px; line-height: 1.35; tab-size: 8; }
.vc-spool pre.vc-sp-wrap { white-space: pre-wrap; overflow-wrap: anywhere; }
.vc-spool pre:focus-visible { outline: 2px solid var(--focus, var(--accent, #2563eb)); outline-offset: 1px; }
.vc-spool mark { background: color-mix(in srgb, var(--warning, #d97706) 30%, transparent); color: inherit; border-radius: 2px; }
.vc-spool mark.vc-sp-on { background: var(--warning, #d97706); color: #fff; }
.vc-spool .vc-sp-note { margin: 0; color: var(--text-muted, #666); }
.vc-spool .vc-sp-message { margin: auto; color: var(--text-muted, #666); text-align: center; }
`;

export function mount(element, ctx) {
  const doc = element.ownerDocument;
  const el = (tag, className, content) => {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    if (content !== undefined) n.textContent = content;
    return n;
  };
  const root = el('section', 'vc-spool');
  element.append(root);
  let current = ctx;
  let s = settings(ctx.options);
  /** What was read: { lines, complete, pages } or null; and the reading state. */
  let doc0 = null;
  let reading = false;
  let error = '';
  let query = '';
  let hit = 0;

  const region = () => regionOf(current.screen.lines, s);
  const pageText = () => {
    const r = region();
    return r.error ? '' : current.screen.lines.slice(r.from - 1, r.to).join('\n');
  };

  const read = () => {
    const r = region();
    if (r.error) { error = r.error; return draw(); }
    if (current.design) {
      doc0 = { lines: documentOf([current.screen.lines.slice(r.from - 1, r.to)]), complete: true, pages: 1, preview: true };
      return draw();
    }
    reading = true;
    error = '';
    draw();
    current.readPages({ from: r.from, to: r.to, maxPages: s.maxPages }).then(
      (data) => {
        reading = false;
        doc0 = { lines: documentOf(data.pages), complete: data.complete, pages: data.pages.length };
        draw();
      },
      (err) => {
        reading = false;
        error = err?.message ?? String(err);
        draw();
      },
    );
  };

  function draw(focusSearch = false) {
    const style = el('style');
    style.textContent = CSS;
    if (s.error) return root.replaceChildren(style, el('p', 'vc-sp-message', `Spool file: ${s.error}`));
    const title = s.title || fileName(current.screen.lines) || 'Spool file';
    const bar = el('div', 'vc-sp-bar');
    bar.append(el('strong', '', title));
    const lines = doc0?.lines ?? null;
    const matches = lines ? findAll(lines, query) : [];
    if (hit >= matches.length) hit = 0;

    const search = el('input');
    search.type = 'search';
    search.placeholder = 'Search';
    search.setAttribute('aria-label', 'Search the spool file');
    search.value = query;
    search.disabled = !lines;
    const count = el('span', 'vc-sp-count', query && lines ? (matches.length ? `${hit + 1} of ${matches.length}` : 'No matches') : '');
    count.setAttribute('role', 'status');
    const go = (by) => {
      if (!matches.length) return;
      hit = (hit + by + matches.length) % matches.length;
      draw(true);
    };
    search.addEventListener('input', () => { query = search.value; hit = 0; draw(true); });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation(); // not Enter for the host
        go(e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 1);
      }
    });
    const button = (label, fn, aria) => {
      const b = el('button', '', label);
      b.type = 'button';
      if (aria) b.setAttribute('aria-label', aria);
      b.addEventListener('click', fn);
      return b;
    };
    const prev = button('↑', () => go(-1), 'Previous match');
    const next = button('↓', () => go(1), 'Next match');
    prev.disabled = next.disabled = matches.length === 0;
    const download = button('Download', () => {
      const blob = new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/plain;charset=utf-8' });
      const a = el('a');
      a.href = URL.createObjectURL(blob);
      a.download = downloadName(title);
      doc.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    download.disabled = !lines || !!doc0?.preview;
    const again = button(reading ? 'Reading…' : lines ? 'Read again' : 'Read whole file', read);
    again.disabled = reading;
    bar.append(search, count, prev, next, download, again);

    const parts = [style, bar];
    if (!lines) {
      const msg = el('p', 'vc-sp-message', error || (reading ? 'Reading every page…' : region().error || 'Read whole file shows every page here.'));
      msg.setAttribute('role', 'status');
      parts.push(msg);
      return root.replaceChildren(...parts);
    }
    const pre = el('pre', s.wrap ? 'vc-sp-wrap' : '');
    pre.tabIndex = 0;
    pre.setAttribute('aria-label', title);
    // Draw lines with matches marked; the current match gets an id to scroll to.
    let m = 0;
    lines.forEach((line, i) => {
      let at = 0;
      while (m < matches.length && matches[m].line === i) {
        const x = matches[m];
        pre.append(doc.createTextNode(line.slice(at, x.start)));
        const mark = el('mark', m === hit ? 'vc-sp-on' : '', line.slice(x.start, x.end));
        pre.append(mark);
        at = x.end;
        m++;
      }
      pre.append(doc.createTextNode(`${line.slice(at)}\n`));
    });
    parts.push(pre);
    const notes = [];
    notes.push(`${lines.length} lines${doc0.pages > 1 ? `, ${doc0.pages} pages` : ''}.`);
    if (!doc0.complete) notes.push(`Stopped after ${doc0.pages} pages; the rest isn't shown.`);
    if (doc0.preview) notes.push('In the designer only the page showing is read.');
    if (error) notes.push(error);
    parts.push(el('p', 'vc-sp-note', notes.join(' ')));
    root.replaceChildren(...parts);
    root.querySelector('mark.vc-sp-on')?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    if (focusSearch) {
      const box = root.querySelector('input[type=search]');
      box?.focus();
      box?.setSelectionRange?.(box.value.length, box.value.length);
    }
  }

  if (s.read === 'auto' || ctx.design) read();
  else draw();
  return {
    update(next) {
      current = next;
      const again = settings(next.options);
      if (JSON.stringify(again) !== JSON.stringify(s)) {
        s = again;
        doc0 = null;
        if (s.read === 'auto' || current.design) read();
        else draw();
        return;
      }
      // Another file on the same screen (its first page isn't the one read): read it.
      if (!reading && doc0 && !doc0.preview && s.read === 'auto') {
        const text = pageText();
        const known = new Set(doc0.lines);
        if (text && !documentOf([text.split('\n')]).every((l) => known.has(l))) {
          doc0 = null;
          read();
        }
      }
    },
    unmount() {
      root.remove();
    },
  };
}
