// Small drop-down menus: the keybar's Export button (Excel or CSV for the list
// on screen) and the header's System menu (SysReq, Attn).

import { useEffect, useRef, useState } from 'react';

export type ExportFormat = 'xlsx' | 'csv';

export interface MenuItem {
  label: string;
  title?: string;
  onPick: () => void;
}

export function DropMenu({ label, title, disabled, up, items }: {
  label: string; title: string; disabled: boolean; up?: boolean; items: MenuItem[];
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
        <div className={`export-pop${up ? '' : ' down'}`} role="menu">
          {items.map((item) => (
            <button key={item.label} type="button" role="menuitem" title={item.title} onClick={() => { setOpen(false); item.onPick(); }}>
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
