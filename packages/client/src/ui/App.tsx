import type { AidName, FieldSnapshot, ScreenSnapshot } from '@veneer/tn5250';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { transform } from '../transform/index.ts';
import type { Action, FunctionKey } from '../transform/types.ts';
import { ClassicScreen } from './ClassicScreen.tsx';
import type { FieldBinding } from './fieldInput.tsx';
import { keyAction, keyHint } from './keys.ts';
import { ModernScreen } from './ModernScreen.tsx';
import { useSession } from './useSession.ts';

type Mode = 'modern' | 'classic';
const MODE_KEY = 'veneer.mode';

function loadMode(): Mode {
  try { return localStorage.getItem(MODE_KEY) === 'classic' ? 'classic' : 'modern'; } catch { return 'modern'; }
}

export function App() {
  const session = useSession();
  const snap = session.screen?.snap ?? null;
  const seq = session.screen?.seq ?? 0;
  const [mode, setMode] = useState<Mode>(loadMode);
  const view = useMemo(() => (snap ? transform(snap) : null), [snap]);

  // Edits made on the current screen, by field id. Cleared on every new screen.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const clickedCursor = useRef<{ row: number; col: number } | null>(null);
  useEffect(() => {
    setEdits({});
    clickedCursor.current = null;
  }, [seq]);

  const binding: FieldBinding = useMemo(() => ({
    value: (f) => edits[f.id] ?? f.value,
    onChange: (f, value) => setEdits((e) => ({ ...e, [f.id]: value })),
  }), [edits]);

  const canSubmit = Boolean(snap && session.state === 'connected' && (!snap.keyboardLocked || snap.error));

  const submit = useCallback((aid: AidName, extra: Record<string, string> = {}) => {
    if (!snap || !canSubmit) return;
    const fields: Record<string, string> = {};
    for (const [id, value] of Object.entries({ ...edits, ...extra })) {
      const f = snap.fields.find((x) => x.id === id);
      if (f && (value !== f.value || f.attr.nonDisplay)) fields[id] = value;
    }
    session.send({ type: 'submit', aid, fields, cursor: currentCursor(snap, clickedCursor.current) });
  }, [snap, canSubmit, edits, session]);

  const onAction = useCallback((a: Action) => submit(a.aid, a.fields), [submit]);

  // Keyboard: Enter, F1-F24, PageUp/PageDown, Esc = Reset.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = keyAction(e);
      if (!action) return;
      e.preventDefault();
      if (action === 'Reset') session.send({ type: 'reset' });
      else submit(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submit, session]);

  // Put focus where the host placed the cursor.
  useEffect(() => {
    if (!snap || snap.keyboardLocked) return;
    const f = fieldAtCursor(snap);
    const el = (f && document.querySelector<HTMLInputElement>(`[data-field="${f.id}"]`))
      || document.querySelector<HTMLInputElement>('[data-field]');
    if (!el) return;
    el.focus();
    if (f && el instanceof HTMLInputElement && el.dataset.field === f.id) {
      const offset = (snap.cursor.row - f.row) * snap.cols + (snap.cursor.col - f.col);
      try { el.setSelectionRange(offset, offset); } catch { /* password inputs on some browsers */ }
    }
  }, [seq, mode, snap]);

  const toggleMode = () => {
    const next = mode === 'modern' ? 'classic' : 'modern';
    setMode(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* ignore */ }
  };

  const keys: FunctionKey[] = view?.functionKeys ?? [];
  const hasTable = view?.items.some((i) => i.kind === 'table') ?? false;
  const busy = session.state === 'connected' && Boolean(snap?.keyboardLocked) && !snap?.error;

  return (
    <div className="app">
      <div className={`busy-bar${busy ? ' on' : ''}`} aria-hidden />
      <header className="topbar">
        <div className="brand" aria-label="Veneer">V</div>
        <div className="titles">
          <h1>{(mode === 'modern' && view?.title) || 'Veneer'}</h1>
          {mode === 'modern' && view && view.meta.length > 0 && (
            <div className="meta">{view.meta.join(' · ')}</div>
          )}
        </div>
        <div className="top-actions">
          <span className={`status status-${session.state}`}>{statusText(session.state, busy)}</span>
          <button type="button" className="ghost mode-toggle" onClick={toggleMode}>
            {mode === 'modern' ? 'Classic view' : 'Modern view'}
          </button>
          {session.state !== 'closed' && (
            <button type="button" className="ghost" onClick={session.disconnect}>Disconnect</button>
          )}
        </div>
      </header>

      <main className="stage">
        {view?.message && mode === 'modern' && (
          <div className={`banner banner-${view.message.kind}`} role={view.message.kind === 'error' ? 'alert' : 'status'}>
            <span>{view.message.text}</span>
            {view.message.kind === 'error' && (
              <button type="button" className="ghost" onClick={() => session.send({ type: 'reset' })}>Reset (Esc)</button>
            )}
          </div>
        )}
        <Toast error={session.error} />

        {snap && view ? (
          <form className="sheet" onSubmit={(e) => e.preventDefault()} autoComplete="off">
            {mode === 'modern'
              ? <ModernScreen view={view} binding={binding} locked={!canSubmit} onAction={onAction}
                  onCursor={(row, col) => { clickedCursor.current = { row, col }; }} />
              : <ClassicScreen snap={snap} binding={binding} />}
          </form>
        ) : (
          session.state !== 'closed' && <div className="placeholder">Connecting to IBM i…</div>
        )}
      </main>

      {snap && (
        <footer className="keybar">
          <button type="button" className="primary" disabled={!canSubmit} onClick={() => submit('Enter')}>
            Enter
          </button>
          {keys.map((k) => (
            <button key={k.aid} type="button" disabled={!canSubmit} onClick={() => submit(k.aid)}>
              <kbd>{keyHint(k.aid)}</kbd>{k.label}
            </button>
          ))}
          {(hasTable || mode === 'classic') && (
            <>
              <button type="button" disabled={!canSubmit} onClick={() => submit('PageUp')}><kbd>PgUp</kbd>Previous</button>
              <button type="button" disabled={!canSubmit} onClick={() => submit('PageDown')}><kbd>PgDn</kbd>Next</button>
            </>
          )}
        </footer>
      )}

      {session.state === 'closed' && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="closed-title">
          <div className="dialog">
            <h2 id="closed-title">Session ended</h2>
            <p>{session.closedReason ?? 'The connection to the IBM i was closed.'}</p>
            <button type="button" className="primary" autoFocus onClick={session.newSession}>Start a new session</button>
          </div>
        </div>
      )}
    </div>
  );
}

function statusText(state: string, busy: boolean): string {
  if (state === 'connected') return busy ? 'Working…' : 'Connected';
  if (state === 'connecting') return 'Connecting…';
  return 'Disconnected';
}

function fieldAtCursor(snap: ScreenSnapshot): FieldSnapshot | undefined {
  const addr = (snap.cursor.row - 1) * snap.cols + (snap.cursor.col - 1);
  return snap.fields.find((f) => {
    const start = (f.row - 1) * snap.cols + (f.col - 1);
    return !f.bypass && addr >= start && addr < start + f.length;
  });
}

/** The cursor to report: the caret in the focused field, else the last clicked text. */
function currentCursor(snap: ScreenSnapshot, clicked: { row: number; col: number } | null) {
  const el = document.activeElement as HTMLInputElement | null;
  const id = el?.dataset?.field;
  const f = id ? snap.fields.find((x) => x.id === id) : undefined;
  if (f) {
    const caret = el instanceof HTMLInputElement ? Math.min(el.selectionStart ?? 0, f.length - 1) : 0;
    const offset = (f.col - 1) + caret;
    return { row: f.row + Math.floor(offset / snap.cols), col: (offset % snap.cols) + 1 };
  }
  return clicked ?? snap.cursor;
}

function Toast({ error }: { error: { id: number; message: string } | null }) {
  const [visible, setVisible] = useState<typeof error>(null);
  useEffect(() => {
    if (!error) return;
    setVisible(error);
    const t = window.setTimeout(() => setVisible(null), 5000);
    return () => window.clearTimeout(t);
  }, [error]);
  return visible ? <div className="toast" role="alert">{visible.message}</div> : null;
}
