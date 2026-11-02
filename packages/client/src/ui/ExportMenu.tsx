// Small drop-down menus: the keybar's Export button (Excel or CSV for the list
// on screen), its Keys menu on a 3270, and the header's System menu (SysReq, Attn).

import { useEffect, useRef, useState } from 'react';

export type ExportFormat = 'xlsx' | 'csv';

export interface MenuItem {
  label: string;
  title?: string;
  onPick: () => void;
  /** Takes a whole row of a menu laid out in columns. */
  wide?: boolean;
}

export function DropMenu({ label, title, disabled, up, start, columns, items }: {
  label: string; title: string; disabled: boolean; up?: boolean;
  /** Line the menu up with the button's left edge (for a button on the left). */
  start?: boolean;
  /** Lay the items out in this many columns. */
  columns?: number;
  items: MenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close, true);
    };
  }, [open]);
  return (
    <div className="export-menu" ref={ref}>
      <button type="button" className={up ? undefined : 'ghost'} disabled={disabled} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(!open)} title={title}>
        {label} ▾
      </button>
      {open && (
        <div
          className={`export-pop${up ? '' : ' down'}${start ? ' start' : ''}`} role="menu"
          style={columns ? { gridTemplateColumns: `repeat(${columns}, auto)` } : undefined}
        >
          {items.map((item) => (
            <button
              key={item.label} type="button" role="menuitem" title={item.title}
              style={item.wide && columns ? { gridColumn: '1 / -1' } : undefined}
              onClick={() => { setOpen(false); item.onPick(); }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ExportMenu({ disabled, onExport }: { disabled: boolean; onExport: (format: ExportFormat) => void }) {
  return (
    <DropMenu label="Export" title="Download every page of this list" disabled={disabled} up items={[
      { label: 'Excel (.xlsx)', onPick: () => onExport('xlsx') },
      { label: 'CSV', onPick: () => onExport('csv') },
    ]} />
  );
}
