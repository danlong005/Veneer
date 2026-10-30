// A collapsible section of the designer panel. Its header says what the
// section holds ("Buttons · 2"), so a closed section still shows whether it is
// in use. Sections start open when in use; what the designer opens or closes
// is kept by the panel (SectionContext), so it survives switching tabs.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export interface SectionState {
  /** Sections opened or closed so far, by title. */
  open: Record<string, boolean>;
  setOpen: (title: string, open: boolean) => void;
}

export const SectionContext = createContext<SectionState | null>(null);

/** Open and closed sections for a SectionContext; `reset` changing forgets them. */
export function useSectionState(reset: unknown): SectionState {
  const [open, setOpenMap] = useState<Record<string, boolean>>({});
  useEffect(() => { setOpenMap({}); }, [reset]);
  return { open, setOpen: (title, value) => setOpenMap((m) => (m[title] === value ? m : { ...m, [title]: value })) };
}

export function Section({ title, count = 0, note, inUse = count > 0, children }: {
  title: string;
  /** How many things the section holds; shown when more than 0. */
  count?: number;
  /** A short status shown instead of a count, such as "3 lines". */
  note?: string | undefined;
  /** Open the section by default; defaults to having a count. */
  inUse?: boolean;
  children: ReactNode;
}) {
  const ctx = useContext(SectionContext);
  const open = ctx?.open[title] ?? inUse;
  // Once open, a section stays open when its last item is removed, so its Add
  // button does not disappear from under the pointer.
  useEffect(() => {
    if (inUse && ctx && ctx.open[title] === undefined) ctx.setOpen(title, true);
  }, [inUse, ctx, title]);
  const id = `dp-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <section className={open ? 'dp-section open' : 'dp-section'}>
      <h4>
        <button type="button" className="dp-section-head" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => ctx?.setOpen(title, !open)}>
          <span className="dp-chevron" aria-hidden="true" />
          <span>
            {title}
            {note ? <span className="dp-count"> · {note}</span> : count > 0 && <span className="dp-count"> · {count}</span>}
          </span>
        </button>
      </h4>
      {open && <div className="dp-section-body" id={id}>{children}</div>}
    </section>
  );
}

/** A heading over a group of sections. */
export function SectionGroup({ title }: { title: string }) {
  return <h3 className="dp-group">{title}</h3>;
}
