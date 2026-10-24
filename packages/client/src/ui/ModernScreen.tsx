// Renders the auto-transformed view. Items keep their 5250 row/column, so
// layouts stay faithful while widgets replace recognised patterns.

import type { Target } from '@veneer/screens';
import type { CSSProperties, MouseEvent, PointerEvent, WheelEvent } from 'react';
import { useEffect, useRef } from 'react';
import { heightOf, homeOf } from '../transform/customize.ts';
import type { Action, Item, ScreenView, TableItem, WindowView } from '../transform/types.ts';
import { FieldInput, type FieldBinding } from './fieldInput.tsx';

interface Props {
  view: ScreenView;
  binding: FieldBinding;
  locked: boolean;
  onAction: (action: Action) => void;
  onCursor: (row: number, col: number) => void;
  /**
   * Designer mode: clicks select items instead of acting on them, and items
   * can be dragged (or nudged with the arrow keys) to move them. Items are
   * named by where the host put them (Item.home).
   */
  design?: {
    selected: Target | null;
    onSelect: (at: Target) => void;
    onMove: (at: Target, by: { rows: number; cols: number }) => void;
    /** Resize custom HTML, in cells. */
    onResize: (at: Target, size: { width: number; height: number }) => void;
  } | undefined;
}

const atKey = (t: Target) => `${t.row}:${t.col}`;
const parseAt = (s: string): Target => {
  const [row, col] = s.split(':').map(Number) as [number, number];
  return { row, col };
};

/** Classes for an item in design mode; `home` is where the host put it. */
function designClass(design: Props['design'], home: Target, hidden?: boolean): string {
  if (!design) return '';
  const selected = design.selected?.row === home.row && design.selected.col === home.col;
  return `${hidden ? ' ghost' : ''}${selected ? ' selected' : ''}`;
}

/**
 * In design mode, swallow the click and report the item's position instead, or
 * for empty space, the cell clicked (where custom HTML can be added).
 */
function selectInDesign(design: Props['design'], top: number, rows: number, cols: number) {
  return (e: MouseEvent<HTMLElement>) => {
    if (!design) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-at]');
    e.preventDefault();
    e.stopPropagation();
    if (el) {
      design.onSelect(parseAt(el.dataset.at!));
      return;
    }
    const box = e.currentTarget.getBoundingClientRect();
    const row = top + Math.floor(((e.clientY - box.top) / box.height) * rows);
    const col = 1 + Math.floor(((e.clientX - box.left) / box.width) * cols);
    if (row >= 1 && col >= 1 && col <= cols) design.onSelect({ row, col });
  };
}

/** The screen cell drawn at the top-left of a container. */
interface Origin {
  row: number;
  col: number;
}

const at = (row: number, col: number, origin: Origin, width?: number): CSSProperties => ({
  top: `calc(${row - origin.row} * var(--rh))`,
  left: `calc(${col - origin.col} * var(--cw))`,
  ...(width !== undefined ? { width: `calc(${width} * var(--cw))` } : {}),
});

function extent(view: ScreenView): { top: number; bottom: number } {
  const rows = view.items.flatMap((i) => [i.row, i.row + heightOf(i) - 1]);
  if (view.window) rows.push(view.window.top - 1, view.window.bottom + 1);
  if (rows.length === 0) return { top: 1, bottom: 1 };
  return { top: Math.min(...rows), bottom: Math.max(...rows) };
}

export function ModernScreen(props: Props) {
  const { view, design } = props;
  const { top, bottom } = extent(view);
  const origin = { row: top, col: 1 };
  const select = selectInDesign(design, top, bottom - top + 1, view.cols);
  const drag = useDrag(design, bottom - top + 1, view.cols);
  useNudge(design);
  return (
    <div
      ref={drag.ref}
      className={`canvas${design ? ' designing' : ''}`}
      style={{ '--cols': view.cols, height: `calc(${bottom - top + 1} * var(--rh))` } as CSSProperties}
      onClickCapture={design ? (e) => {
        if (!drag.swallowClick()) return select(e);
        e.preventDefault();
        e.stopPropagation();
      } : undefined}
      onMouseDownCapture={design ? (e) => e.preventDefault() : undefined}
      onPointerDown={design ? drag.down : undefined}
      onPointerMove={design ? drag.move : undefined}
      onPointerUp={design ? drag.up : undefined}
      onPointerCancel={design ? drag.cancel : undefined}
    >
      {view.window ? (
        <>
          <div className="background" aria-hidden inert={!props.design}>
            <Items {...props} items={view.items} origin={origin} />
          </div>
          <Window {...props} win={view.window} origin={origin} />
        </>
      ) : (
        <Items {...props} items={view.items} origin={origin} />
      )}
    </div>
  );
}

/** A pop-up window: a card over the border's cells, interior items inside it. */
function Window(props: Props & { win: WindowView; origin: Origin }) {
  const { win, origin } = props;
  const width = win.right - win.left + 3;
  const height = win.bottom - win.top + 3;
  return (
    <div
      className="window"
      role="dialog"
      aria-modal="true"
      aria-label={win.title ?? 'Window'}
      style={{ ...at(win.top - 1, win.left - 1, origin, width), height: `calc(${height} * var(--rh))` }}
    >
      <div className="window-title">{win.title}</div>
      <div className="window-body" style={{ top: 'var(--rh)', left: 'var(--cw)' }}>
        <Items {...props} items={win.items} origin={{ row: win.top, col: win.left }} />
      </div>
    </div>
  );
}

function Items({ items, origin, binding, locked, onAction, onCursor, view, design }: Props & { items: Item[]; origin: Origin }) {
  const top = origin;
  const cols = view.cols;
  return (
    <>
      {items.map((item) => {
        const home = homeOf(item);
        const key = `${item.kind}-${home.row}-${home.col}`;
        switch (item.kind) {
          case 'text':
            return (
              <span
                key={key}
                className={`text role-${item.role}${item.reverse ? ' reverse' : ''}${item.underline ? ' underline' : ''}${designClass(design, home, item.hidden)}`}
                style={at(item.row, item.col, top)}
                data-at={atKey(home)}
                onClick={() => onCursor(home.row, home.col)}
              >
                {item.text}
              </span>
            );
          case 'field': {
            const width = Math.min(item.width, cols - item.col + 1);
            return (
              <FieldInput
                key={key}
                field={item.field}
                binding={binding}
                label={item.label}
                widget={item.widget}
                readOnly={Boolean(design)}
                dataAt={atKey(home)}
                className={`${item.command ? 'command' : ''}${designClass(design, home, item.hidden)}`}
                style={at(item.row, item.col, top, width)}
              />
            );
          }
          case 'link':
            return (
              <button
                key={key}
                type="button"
                className={`${item.key ? 'menu-link' : 'more-link'}${designClass(design, home, item.hidden)}`}
                style={at(item.row, item.col, top)}
                data-at={atKey(home)}
                disabled={locked}
                onClick={() => onAction(item.action)}
              >
                {item.key && <span className="menu-key">{item.key}</span>}
                {item.text}
                {!item.key && <span aria-hidden> ↓</span>}
              </button>
            );
          case 'table':
            return <Table key={key} table={item} origin={origin} binding={binding} locked={locked} onAction={onAction} design={design} />;
          case 'html': {
            const selected = design?.selected?.row === item.row && design.selected.col === item.col;
            // Written by the site's designers, who are trusted like the site's own code.
            return [
              <div
                key={key}
                className={`custom-html${designClass(design, home, item.hidden)}`}
                style={{ ...at(item.row, item.col, top, item.width), height: `calc(${item.height} * var(--rh))` }}
                data-at={atKey(home)}
                data-html={atKey(home)}
                data-size={`${item.width}:${item.height}`}
                dangerouslySetInnerHTML={{ __html: item.html }}
              />,
              selected && (
                <div
                  key={`${key}-resize`}
                  className="resize-handle"
                  data-resize={atKey(home)}
                  title="Drag to resize"
                  style={at(item.row + item.height, item.col + item.width, top)}
                />
              ),
              // CSS nesting scopes the box's CSS to it.
              item.css && <style key={`${key}-css`}>{`[data-html="${item.row}:${item.col}"] {\n${item.css}\n}`}</style>,
            ];
          }
        }
      })}
    </>
  );
}

function Table({ table, origin, binding, locked, onAction, design }: {
  table: TableItem; origin: Origin; binding: FieldBinding; locked: boolean; onAction: (a: Action) => void; design: Props['design'];
}) {
  const lastWheel = useRef(0);
  const onWheel = (e: WheelEvent) => {
    const now = Date.now();
    if (locked || now - lastWheel.current < 600 || Math.abs(e.deltaY) < 20) return;
    if (e.deltaY > 0 && !table.more) return;
    lastWheel.current = now;
    onAction({ aid: e.deltaY > 0 ? 'PageDown' : 'PageUp' });
  };
  const rel = (col: number, width: number): CSSProperties => ({
    left: `calc(${col - table.col} * var(--cw))`,
    width: `calc(${width} * var(--cw))`,
  });
  return (
    <div
      className={`table${designClass(design, homeOf(table), table.hidden)}`}
      role="table"
      data-at={atKey(homeOf(table))}
      style={{ ...at(table.row, table.col, origin, table.width), height: `calc(${table.height} * var(--rh))` }}
      onWheel={onWheel}
    >
      <div className="thead" role="row" style={{ height: `calc(${table.headerRows} * var(--rh))` }}>
        {table.columns.map((c) => (
          <div key={c.col} role="columnheader" className="th" style={rel(c.col, c.width)}>
            <span>{c.header}</span>
          </div>
        ))}
      </div>
      {table.rows.map((r, i) => (
        <div
          key={r.row}
          role="row"
          className={`tr${i % 2 ? ' odd' : ''}`}
          style={{ top: `calc(${r.row - table.row} * var(--rh))` }}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('[data-field]')) return;
            (e.currentTarget.querySelector('[data-field]') as HTMLElement | null)?.focus();
          }}
        >
          {r.cells.map((c) => (
            <div key={c.col} role="cell" className={`td role-${c.role}`} style={rel(c.col, c.width)}>
              {c.field ? (
                <FieldInput
                  field={c.field}
                  binding={binding}
                  options={c.options}
                  widget={c.widget}
                  readOnly={Boolean(design)}
                  dataAt={`${c.field.row}:${c.field.col}`}
                  className={designClass(design, { row: c.field.row, col: c.field.col })}
                  label={table.columns.find((col) => col.col === c.col)?.header}
                  style={c.options ? undefined : { width: `calc(${Math.max(c.field.length, 1)} * var(--cw) + 1.2em)` }}
                />
              ) : (
                c.text
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Designer dragging: drag an item to move it, or a custom HTML box's corner
 * handle to resize it. Positions snap to screen cells. The element follows the
 * pointer with a transform; on release the change goes to the designer, and the
 * next render draws the item in its new place. A press without movement is a
 * click, which selects.
 */
function useDrag(design: Props['design'], rows: number, cols: number) {
  const ref = useRef<HTMLDivElement>(null);
  const state = useRef<{
    el: HTMLElement; at: Target; mode: 'move' | 'resize'; x: number; y: number; cw: number; rh: number;
    size: { width: number; height: number }; style: string; active: boolean; dr: number; dc: number;
  } | null>(null);
  const swallow = useRef(false);

  const reset = (s: NonNullable<typeof state.current>) => {
    s.el.setAttribute('style', s.style);
    s.el.classList.remove('dragging');
  };
  return {
    ref,
    /** True (once) if the click that follows a drag should be ignored. */
    swallowClick: () => {
      const v = swallow.current;
      swallow.current = false;
      return v;
    },
    down: (e: PointerEvent<HTMLDivElement>) => {
      const canvas = ref.current;
      if (!design || !canvas || e.button !== 0) return;
      const target = e.target as HTMLElement;
      const handle = target.closest<HTMLElement>('[data-resize]');
      let el = handle
        ? canvas.querySelector<HTMLElement>(`[data-html="${handle.dataset.resize}"]`)
        : target.closest<HTMLElement>('[data-at]');
      // A field or cell inside a table moves the whole table.
      if (el && !handle) el = el.closest<HTMLElement>('.table') ?? el;
      if (!el?.dataset.at) return;
      const box = canvas.getBoundingClientRect();
      const [w, h] = (el.dataset.size ?? '1:1').split(':').map(Number) as [number, number];
      state.current = {
        el, at: parseAt(el.dataset.at), mode: handle ? 'resize' : 'move', x: e.clientX, y: e.clientY,
        cw: box.width / cols, rh: box.height / rows, size: { width: w, height: h },
        style: el.getAttribute('style') ?? '', active: false, dr: 0, dc: 0,
      };
    },
    move: (e: PointerEvent<HTMLDivElement>) => {
      const s = state.current;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (!s.active && Math.hypot(dx, dy) < 4) return;
      // Capture only once it's a drag, so a plain click still lands on the item.
      if (!s.active) ref.current?.setPointerCapture(e.pointerId);
      s.active = true;
      s.el.classList.add('dragging');
      s.dc = Math.round(dx / s.cw);
      s.dr = Math.round(dy / s.rh);
      if (s.mode === 'move') {
        s.el.style.transform = `translate(${s.dc * s.cw}px, ${s.dr * s.rh}px)`;
      } else {
        s.el.style.width = `calc(${Math.max(1, s.size.width + s.dc)} * var(--cw))`;
        s.el.style.height = `calc(${Math.max(1, s.size.height + s.dr)} * var(--rh))`;
      }
    },
    up: () => {
      const s = state.current;
      state.current = null;
      if (!s?.active || !design) return;
      swallow.current = true;
      reset(s);
      if (s.mode === 'move') {
        // Select first: moving an HTML box changes its position, and selects it there.
        design.onSelect(s.at);
        if (s.dr || s.dc) design.onMove(s.at, { rows: s.dr, cols: s.dc });
      } else {
        design.onResize(s.at, { width: Math.max(1, s.size.width + s.dc), height: Math.max(1, s.size.height + s.dr) });
      }
    },
    cancel: () => {
      if (state.current) reset(state.current);
      state.current = null;
    },
  };
}

/** Arrow keys move the selected item one cell (not while typing in the panel). */
function useNudge(design: Props['design']) {
  const latest = useRef(design);
  latest.current = design;
  const active = Boolean(design);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const d = latest.current;
      const by = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      if (!d?.selected || !by || e.altKey || e.ctrlKey || e.metaKey) return;
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      d.onMove(d.selected, { rows: by[0]!, cols: by[1]! });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}
