// The help panel the host showed, in a popover next to the field it is about
// (see help/help.ts). Esc or Close closes it; More pages through long help.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { HelpPage } from '../help/help.ts';

const GAP = 8;
const MARGIN = 12;

export function HelpPopover({ page, anchor, busy, onMore, onClose }: {
  /** Null while the host is still answering. */
  page: HelpPage | null;
  /** The field's id (data-field), to place the popover by it. */
  anchor: string | undefined;
  busy: boolean;
  onMore: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });

  // Below the field, else above it, kept on screen; centered when there is no field.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const field = anchor ? document.querySelector<HTMLElement>(`[data-field="${CSS.escape(anchor)}"]`) : null;
    const at = field?.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!at || at.width === 0) {
      setStyle({ left: Math.max(MARGIN, (vw - box.width) / 2), top: Math.max(MARGIN, vh * 0.18) });
      return;
    }
    const left = Math.min(Math.max(MARGIN, at.left), vw - box.width - MARGIN);
    const below = at.bottom + GAP;
    const top = below + box.height <= vh - MARGIN ? below : Math.max(MARGIN, at.top - GAP - box.height);
    setStyle({ left, top });
  }, [anchor, page]);

  useEffect(() => { close.current?.focus(); }, [page]);

  return (
    <div ref={ref} className="help-popover" role="dialog" aria-labelledby="help-title" aria-busy={busy} style={style}>
      <div className="help-head">
        <h2 id="help-title">{page?.title ?? 'Help'}</h2>
        <button ref={close} type="button" className="dp-x" aria-label="Close help" title="Close (Esc)" onClick={onClose}>×</button>
      </div>
      <div className="help-body">
        {page === null ? <p className="help-wait">Getting help…</p>
          : page.paragraphs.length === 0 ? <p className="help-wait">The host's help panel has no text.</p>
            : page.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
      </div>
      {page?.more && (
        <div className="help-foot">
          <button type="button" className="ghost" disabled={busy} onClick={onMore}>More <kbd>PgDn</kbd></button>
        </div>
      )}
    </div>
  );
}
