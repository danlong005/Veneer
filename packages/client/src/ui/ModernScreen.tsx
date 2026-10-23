// Renders the auto-transformed view. Items keep their 5250 row/column, so
// layouts stay faithful while widgets replace recognised patterns.

import type { CSSProperties, WheelEvent } from 'react';
import { useRef } from 'react';
import type { Action, Item, ScreenView, TableItem } from '../transform/types.ts';
import { FieldInput, type FieldBinding } from './fieldInput.tsx';

interface Props {
  view: ScreenView;
  binding: FieldBinding;
  locked: boolean;
  onAction: (action: Action) => void;
  onCursor: (row: number, col: number) => void;
}

const at = (row: number, col: number, top: number, width?: number): CSSProperties => ({
  top: `calc(${row - top} * var(--rh))`,
  left: `calc(${col - 1} * var(--cw))`,
  ...(width !== undefined ? { width: `calc(${width} * var(--cw))` } : {}),
});

function extent(items: Item[]): { top: number; bottom: number } {
  if (items.length === 0) return { top: 1, bottom: 1 };
  const top = Math.min(...items.map((i) => i.row));
  const bottom = Math.max(...items.map((i) => (i.kind === 'table' ? i.row + i.height - 1 : i.row)));
  return { top, bottom };
}

export function ModernScreen({ view, binding, locked, onAction, onCursor }: Props) {
  const { top, bottom } = extent(view.items);
  return (
    <div
      className="canvas"
      style={{ '--cols': view.cols, height: `calc(${bottom - top + 1} * var(--rh))` } as CSSProperties}
    >
      {view.items.map((item) => {
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
            const width = Math.min(item.width, view.cols - item.col + 1);
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
            return <Table key={key} table={item} top={top} binding={binding} locked={locked} onAction={onAction} />;
        }
      })}
    </div>
  );
}

function Table({ table, top, binding, locked, onAction }: {
  table: TableItem; top: number; binding: FieldBinding; locked: boolean; onAction: (a: Action) => void;
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
      style={{ ...at(table.row, table.col, top, table.width), height: `calc(${table.height} * var(--rh))` }}
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
