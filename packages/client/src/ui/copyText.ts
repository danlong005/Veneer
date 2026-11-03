// Copying from the screen. Items are drawn each at its own place, so the
// browser's own copy runs them together in page order and leaves out what is
// in the fields (on an ISPF View or Edit screen, the data itself). Instead
// the copy is laid out again on the screen's grid: one line per row, each
// piece at its column, field values included.

/** Text at a place on the drawn grid: row and column from 0. */
export interface Piece {
  row: number;
  col: number;
  text: string;
}

/**
 * The text of pieces on the grid, one line per row from the first to the
 * last, each piece padded out to its column (or a space after the text
 * before it, if that runs past), trailing blanks dropped and the indent
 * every line shares taken off.
 */
export function gridText(pieces: readonly Piece[]): string {
  const rows = new Map<number, Piece[]>();
  for (const p of pieces) {
    if (!p.text) continue;
    const row = rows.get(p.row);
    if (row) row.push(p);
    else rows.set(p.row, [p]);
  }
  if (rows.size === 0) return '';
  const numbers = [...rows.keys()];
  const first = Math.min(...numbers);
  const last = Math.max(...numbers);
  const lines: string[] = [];
  for (let r = first; r <= last; r++) {
    let line = '';
    for (const p of (rows.get(r) ?? []).sort((a, b) => a.col - b.col)) {
      if (p.col > line.length) line = line.padEnd(p.col);
      else if (line && !line.endsWith(' ')) line += ' ';
      line += p.text;
    }
    lines.push(line.trimEnd());
  }
  const indents = lines.filter((l) => l).map((l) => l.length - l.trimStart().length);
  const indent = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(indent)).join('\n');
}

/** Fields whose value is copied: text boxes, text areas and drop-downs, not passwords or check boxes. */
const TEXT_INPUT = new Set(['text', 'date', 'number', 'search', '']);

function fieldText(el: Element): string | undefined {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return el.value;
  if (el instanceof HTMLInputElement) return TEXT_INPUT.has(el.getAttribute('type') ?? '') ? el.value : undefined;
  return undefined;
}

/**
 * The selection's text within a canvas, laid out on its grid, or undefined
 * when the selection doesn't reach the canvas. Text before or after the
 * canvas (TSO's earlier output, above it) is kept as the browser has it.
 */
export function selectedScreenText(canvas: HTMLElement, cols: number, rows: number): string | undefined {
  const sel = canvas.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return undefined;
  const range = sel.getRangeAt(0);
  if (!range.intersectsNode(canvas)) return undefined;

  const box = canvas.getBoundingClientRect();
  const cw = box.width / cols;
  const rh = box.height / rows;
  const cell = (rect: DOMRect) => ({
    row: Math.floor((rect.top - box.top + Math.min(rect.height, rh) / 2) / rh),
    col: Math.round((rect.left - box.left) / cw),
  });
  // Not drawn, or drawn for show: a hidden tab, the screen behind a window, an
  // arrow, a button that is an icon (a spinner's ▴ ▾).
  const unseen = (el: Element) => el.closest('[hidden], [aria-hidden="true"], [inert], button[aria-label]') !== null;

  const pieces: Piece[] = [];
  const walker = canvas.ownerDocument.createTreeWalker(canvas, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    if (node instanceof Element) {
      if (!node.hasAttribute('data-field') || unseen(node)) continue;
      const value = fieldText(node);
      if (value === undefined) continue;
      const at = cell(node.getBoundingClientRect());
      value.split('\n').forEach((text, i) => pieces.push({ row: at.row + i, col: at.col, text }));
      continue;
    }
    const parent = node.parentElement;
    if (!parent || unseen(parent) || parent.closest('[data-field]')) continue;
    const text = node.textContent ?? '';
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : text.length;
    const whole = canvas.ownerDocument.createRange();
    whole.selectNodeContents(node);
    const at = cell(whole.getBoundingClientRect());
    // Screen text keeps to its cells, so the nth character is n columns on.
    pieces.push({ row: at.row, col: at.col + from, text: text.slice(from, to) });
  }

  const around = canvas.ownerDocument.createRange();
  around.selectNode(canvas);
  const outside = (start: boolean) => {
    const r = range.cloneRange();
    if (start) {
      if (range.compareBoundaryPoints(Range.START_TO_START, around) >= 0) return '';
      r.setEndBefore(canvas);
    } else {
      if (range.compareBoundaryPoints(Range.END_TO_END, around) <= 0) return '';
      r.setStartAfter(canvas);
    }
    return r.toString().replace(/\s+$/, '');
  };
  return [outside(true), gridText(pieces), outside(false)].filter(Boolean).join('\n');
}

/** Whether a text box or text area has text of its own selected, which the browser copies. */
export function copyingInField(doc: Document): boolean {
  const el = doc.activeElement;
  return (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
    && el.selectionStart !== null && el.selectionStart !== el.selectionEnd;
}
