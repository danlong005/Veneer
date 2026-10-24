// The keybar's Export button: pick Excel or CSV for the list on screen.

import { useEffect, useRef, useState } from 'react';

export type ExportFormat = 'xlsx' | 'csv';

export function ExportMenu({ disabled, onExport }: { disabled: boolean; onExport: (format: ExportFormat) => void }) {
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
  const pick = (format: ExportFormat) => {
    setOpen(false);
    onExport(format);
  };
  return (
    <div className="export-menu" ref={ref}>
      <button type="button" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}
        title="Download every page of this list">
        Export ▾
      </button>
      {open && (
        <div className="export-pop" role="menu">
          <button type="button" role="menuitem" onClick={() => pick('xlsx')}>Excel (.xlsx)</button>
          <button type="button" role="menuitem" onClick={() => pick('csv')}>CSV</button>
        </div>
      )}
    </div>
  );
}
