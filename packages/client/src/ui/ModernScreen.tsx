// Renders the auto-transformed view. Items keep their 5250 row/column, so
// layouts stay faithful while widgets replace recognised patterns.

import type { CSSProperties, WheelEvent } from 'react';
import { useRef } from 'react';
import type { Action, Item, ScreenView, TableItem, WindowView } from '../transform/types.ts';
import { FieldInput, type FieldBinding } from './fieldInput.tsx';

interface Props {
  view: ScreenView;
  binding: FieldBinding;
  locked: boolean;
  onAction: (action: Action) => void;
  onCursor: (row: number, col: number) => void;
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
  const rows = view.items.flatMap((i) => [i.row, i.kind === 'table' ? i.row + i.height - 1 : i.row]);
  if (view.window) rows.push(view.window.top - 1, view.window.bottom + 1);
  if (rows.length === 0) return { top: 1, bottom: 1 };
  return { top: Math.min(...rows), bottom: Math.max(...rows) };
}

export function ModernScreen(props: Props) {
  const { view } = props;
  const { top, bottom } = extent(view);
  const origin = { row: top, col: 1 };
  return (
    <div
      className="canvas"
      style={{ '--cols': view.cols, height: `calc(${bottom - top + 1} * var(--rh))` } as CSSProperties}
    >
      {view.window ? (
        <>
          <div className="background" aria-hidden inert>
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

function Items({ items, origin, binding, locked, onAction, onCursor, view }: Props & { items: Item[]; origin: Origin }) {
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
                className={`text role-${item.role}${item.reverse ? ' reverse' : ''}${item.underline ? ' underline' : ''}`}
                style={at(item.row, item.col, top)}
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
                className={item.command ? 'command' : undefined}
                style={at(item.row, item.col, top, width)}
              />
            );
          }
          case 'link':
            return (
              <button
                key={key}
                type="button"
                className={item.key ? 'menu-link' : 'more-link'}
                style={at(item.row, item.col, top)}
                disabled={locked}
                onClick={() => onAction(item.action)}
              >
                {item.key && <span className="menu-key">{item.key}</span>}
                {item.text}
                {!item.key && <span aria-hidden> ↓</span>}
              </button>
            );
          case 'table':
            return <Table key={key} table={item} origin={origin} binding={binding} locked={locked} onAction={onAction} />;
        }
      })}
    </>
  );
}

function Table({ table, origin, binding, locked, onAction }: {
  table: TableItem; origin: Origin; binding: FieldBinding; locked: boolean; onAction: (a: Action) => void;
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
      className="table"
      role="table"
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
