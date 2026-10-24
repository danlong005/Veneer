// Renders the auto-transformed view. Items keep their 5250 row/column, so
// layouts stay faithful while widgets replace recognised patterns.

import type { Target } from '@veneer/screens';
import type { CSSProperties, MouseEvent, WheelEvent } from 'react';
import { useRef } from 'react';
import { heightOf } from '../transform/customize.ts';
import type { Action, Item, ScreenView, TableItem, WindowView } from '../transform/types.ts';
import { FieldInput, type FieldBinding } from './fieldInput.tsx';

interface Props {
  view: ScreenView;
  binding: FieldBinding;
  locked: boolean;
  onAction: (action: Action) => void;
  onCursor: (row: number, col: number) => void;
  /** Designer mode: clicks select items instead of acting on them. */
  design?: { selected: Target | null; onSelect: (at: Target) => void } | undefined;
}

/** Classes for an item in design mode. */
function designClass(design: Props['design'], row: number, col: number, hidden?: boolean): string {
  if (!design) return '';
  const selected = design.selected?.row === row && design.selected.col === col;
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
      const [row, col] = el.dataset.at!.split(':').map(Number) as [number, number];
      design.onSelect({ row, col });
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
  const { view } = props;
  const { top, bottom } = extent(view);
  const origin = { row: top, col: 1 };
  const select = selectInDesign(props.design, top, bottom - top + 1, view.cols);
  return (
    <div
      className={`canvas${props.design ? ' designing' : ''}`}
      style={{ '--cols': view.cols, height: `calc(${bottom - top + 1} * var(--rh))` } as CSSProperties}
      onClickCapture={props.design ? select : undefined}
      onMouseDownCapture={props.design ? (e) => e.preventDefault() : undefined}
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
        const key = `${item.kind}-${item.row}-${item.col}`;
        switch (item.kind) {
          case 'text':
            return (
              <span
                key={key}
                className={`text role-${item.role}${item.reverse ? ' reverse' : ''}${item.underline ? ' underline' : ''}${designClass(design, item.row, item.col, item.hidden)}`}
                style={at(item.row, item.col, top)}
                data-at={`${item.row}:${item.col}`}
                onClick={() => onCursor(item.row, item.col)}
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
                dataAt={`${item.row}:${item.col}`}
                className={`${item.command ? 'command' : ''}${designClass(design, item.row, item.col, item.hidden)}`}
                style={at(item.row, item.col, top, width)}
              />
            );
          }
          case 'link':
            return (
              <button
                key={key}
                type="button"
                className={`${item.key ? 'menu-link' : 'more-link'}${designClass(design, item.row, item.col, item.hidden)}`}
                style={at(item.row, item.col, top)}
                data-at={`${item.row}:${item.col}`}
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
          case 'html':
            // Written by the site's designers, who are trusted like the site's own code.
            return [
              <div
                key={key}
                className={`custom-html${designClass(design, item.row, item.col, item.hidden)}`}
                style={{ ...at(item.row, item.col, top, item.width), height: `calc(${item.height} * var(--rh))` }}
                data-at={`${item.row}:${item.col}`}
                data-html={`${item.row}:${item.col}`}
                dangerouslySetInnerHTML={{ __html: item.html }}
              />,
              // CSS nesting scopes the box's CSS to it.
              item.css && <style key={`${key}-css`}>{`[data-html="${item.row}:${item.col}"] {\n${item.css}\n}`}</style>,
            ];
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
      className={`table${designClass(design, table.row, table.col, table.hidden)}`}
      role="table"
      data-at={`${table.row}:${table.col}`}
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
                  className={designClass(design, c.field.row, c.field.col)}
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
