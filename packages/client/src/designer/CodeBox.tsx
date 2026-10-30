// A code box in the designer panel, with a button that opens the same code in
// a large dialog. Both edit the same value, so changes show on the screen as
// they are typed and Undo covers them. Esc closes the dialog and puts the
// cursor back in the small box where it was in the large one.

import { useEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

interface Props extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'className'> {
  value: string;
  onChange: (value: string) => void;
  /** Names the code, as the dialog's title and the box's accessible name. */
  label: string;
  /** Extra classes for the small box, such as "dp-solo". */
  className?: string;
}

export function CodeBox({ value, onChange, label, className = '', ...rest }: Props) {
  const small = useRef<HTMLTextAreaElement>(null);
  const large = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  // The cursor carries over each way, so the code stays where the designer was.
  const caret = useRef<[number, number]>([0, 0]);
  const keep = (el: HTMLTextAreaElement | null) => { if (el) caret.current = [el.selectionStart, el.selectionEnd]; };
  const restore = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.focus();
    el.setSelectionRange(...caret.current);
  };

  // Set when the dialog opens or closes, so focus moves then and not on first draw.
  const toggled = useRef(false);
  const close = () => {
    keep(large.current);
    toggled.current = true;
    setOpen(false);
  };
  const downOnBackdrop = useRef(false);
  // Esc closes the dialog wherever the focus is.
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => {
    if (!toggled.current) return;
    toggled.current = false;
    restore(open ? large.current : small.current);
  }, [open]);

  return (
    <div className="dp-codebox">
      <textarea
        ref={small} {...rest} className={`dp-code ${className}`.trim()} spellCheck={false} aria-label={label}
        value={value} onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button" className="dp-expand" aria-label={`Expand: ${label}`} title="Edit in a larger box"
        onClick={() => { keep(small.current); toggled.current = true; setOpen(true); }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M7 1h4v4M11 1 7 5M5 11H1V7M1 11l4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {/* On the page itself: inside a <label>, a click in the dialog would focus the small box. */}
      {open && createPortal(
        <div
          className="overlay"
          // A click on the backdrop closes; a text selection that ends there does not.
          onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
          onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) close(); }}
        >
          {/* tabIndex: a click on the dialog's text keeps the focus in it. */}
          <div className="dialog dp-code-dialog" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
            <div className="dp-code-dialog-head">
              <h2>{label}</h2>
              <button type="button" className="ghost" onClick={close}>Done</button>
            </div>
            <textarea
              ref={large} className="dp-code dp-code-large" spellCheck={false} aria-label={label}
              placeholder={rest.placeholder} value={value} onChange={(e) => onChange(e.target.value)}
            />
            <p className="dp-hint">Changes apply as you type. Esc or Done goes back to the panel.</p>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
