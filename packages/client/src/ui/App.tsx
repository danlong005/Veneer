import type { AidName, ScreenSnapshot } from '@veneer/tn5250';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { matchScreen, type ScreenDefinition, type Target } from '@veneer/screens';
import { DesignPanel } from '../designer/DesignPanel.tsx';
import { newDefinition, resolveSelection } from '../designer/edit.ts';
import { customize } from '../transform/customize.ts';
import { transform } from '../transform/index.ts';
import type { Action, FunctionKey } from '../transform/types.ts';
import { ClassicScreen } from './ClassicScreen.tsx';
import type { FieldBinding } from './fieldInput.tsx';
import { keyAction, keyHint, typedKey } from './keys.ts';
import { checkFields } from './fieldRules.ts';
import { ModernScreen } from './ModernScreen.tsx';
import { MAX_TYPEAHEAD, caretAtCursor, caretPosition, replay, type Caret, type ReplayResult, type TypedKey } from './typeahead.ts';
import { useScreens } from './useScreens.ts';
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
  const screens = useScreens(session.screensVersion);
  const definition = useMemo(() => (snap ? matchScreen(snap, screens.screens) : undefined), [snap, screens.screens]);

  // Designer: a draft definition previewed live in place of the matched one.
  const [draft, setDraft] = useState<ScreenDefinition | null>(null);
  const [draftExisting, setDraftExisting] = useState(false);
  const [selectedAt, setSelectedAt] = useState<Target | null>(null);
  const designing = draft !== null;
  const designingNow = useRef(false);
  designingNow.current = designing;

  const baseView = useMemo(() => (snap ? transform(snap) : null), [snap]);
  const view = useMemo(
    () => (baseView ? customize(baseView, designing ? draft : definition, { design: designing }) : null),
    [baseView, definition, draft, designing],
  );
  const selection = useMemo(
    () => (designing && view && snap && selectedAt ? resolveSelection(view, snap, selectedAt) : null),
    [designing, view, snap, selectedAt],
  );
  const savedDraft = draft ? screens.screens.find((d) => d.id === draft.id) : undefined;

  const startDesign = () => {
    if (!snap || !baseView) return;
    setDraft(definition ? structuredClone(definition) : newDefinition(snap, baseView));
    setDraftExisting(Boolean(definition));
    setSelectedAt(null);
    setMode('modern');
  };
  const confirmDiscard = () => {
    const unsaved = draft && (savedDraft ? JSON.stringify(savedDraft) !== JSON.stringify(draft) : draft.changes.length > 0 || Boolean(draft.title));
    return !unsaved || window.confirm('Discard unsaved design changes?');
  };
  const stopDesign = () => {
    if (!confirmDiscard()) return;
    setDraft(null);
    setSelectedAt(null);
  };
  const pickDefinition = (def: ScreenDefinition | null) => {
    if (!snap || !baseView || !confirmDiscard()) return;
    setDraft(def ? structuredClone(def) : newDefinition(snap, baseView));
    setDraftExisting(def !== null);
  };

  // Edits made on the current screen, by field id.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const clickedCursor = useRef<{ row: number; col: number } | null>(null);
  // Seq of the screen an AID was sent from; cleared when a newer screen unlocks.
  const [awaitingSeq, setAwaitingSeq] = useState<number | null>(null);
  // Keys typed while waiting, replayed into the next screen (type-ahead).
  const queue = useRef<TypedKey[]>([]);
  const [queued, setQueued] = useState(0);
  // Where to put focus after the next render.
  const focusTarget = useRef<Caret | null>(null);

  // Problems found before sending (mandatory fields), shown like server errors.
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(null);
  useEffect(() => { if (session.error) setNotice(session.error); }, [session.error]);

  const connected = session.state === 'connected' && snap !== null;
  const canSubmit = Boolean(connected && awaitingSeq === null && (!snap!.keyboardLocked || snap!.error));
  const typingAhead = connected && !canSubmit && !snap!.error;
  // Set synchronously when an AID is sent, so keys typed before React re-renders
  // are queued rather than landing in the old screen's fields.
  const awaitingNow = useRef(false);
  const typingAheadNow = useRef(false);
  typingAheadNow.current = typingAhead;

  const sendAid = useCallback((aid: AidName, values: Record<string, string>, cursor: { row: number; col: number }) => {
    if (!snap) return;
    const fields: Record<string, string> = {};
    for (const [id, value] of Object.entries(values)) {
      const f = snap.fields.find((x) => x.id === id);
      if (f && (value !== f.value || f.attr.nonDisplay)) fields[id] = value;
    }
    awaitingNow.current = true;
    setAwaitingSeq(seq);
    session.send({ type: 'submit', aid, fields, cursor });
  }, [snap, seq, session]);

  const submit = useCallback((aid: AidName, extra: Record<string, string> = {}) => {
    if (!snap || !canSubmit) return;
    const values = { ...edits, ...extra };
    if (aid === 'Enter') {
      const problem = checkFields(snap.fields, values);
      if (problem) {
        setNotice({ id: Date.now(), message: problem.message });
        focusTarget.current = endOf(snap, values, problem.id);
        setEdits(values);
        return;
      }
    }
    sendAid(aid, values, currentCursor(snap, clickedCursor.current));
  }, [snap, canSubmit, edits, sendAid]);

  const binding: FieldBinding = useMemo(() => ({
    value: (f) => edits[f.id] ?? f.value,
    onChange: (f, value) => setEdits((e) => ({ ...e, [f.id]: value })),
    onAutoEnter: (f, value) => submit('Enter', { [f.id]: value }),
  }), [edits, submit]);

  const onAction = useCallback((a: Action) => submit(a.aid, a.fields), [submit]);

  // Each new screen: once it unlocks, replay type-ahead and place the cursor.
  useEffect(() => {
    if (!snap) return;
    clickedCursor.current = null;
    if (snap.error) {
      // As on a 5250, an error discards anything typed ahead.
      queue.current = [];
      setQueued(0);
      awaitingNow.current = false;
      setAwaitingSeq(null);
      setEdits({});
      return;
    }
    if (snap.keyboardLocked) return;
    // Any newer unlocked screen answers the AID we were waiting on.
    awaitingNow.current = false;
    setNotice(null);
    setAwaitingSeq(null);
    const start = { edits: {}, caret: caretAtCursor(snap) };
    const result: ReplayResult = queue.current.length > 0 ? replay(snap, start, queue.current) : { state: start, rest: [] };
    queue.current = result.rest;
    setQueued(result.rest.length);
    setEdits(result.state.edits);
    focusTarget.current = result.state.caret;
    if (result.aid) {
      const problem = result.aid === 'Enter' ? checkFields(snap.fields, result.state.edits) : null;
      if (problem) {
        // Stop replaying, as a 5250 does on an operator error.
        queue.current = [];
        setQueued(0);
        setNotice({ id: Date.now(), message: problem.message });
        focusTarget.current = endOf(snap, result.state.edits, problem.id);
        setEdits(result.state.edits);
      } else {
        const caret = result.state.caret;
        sendAid(result.aid, result.state.edits, (caret && caretPosition(snap, caret)) ?? snap.cursor);
      }
    }
    // Only a new screen should trigger this, not edits or the callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  // Apply a pending focus after rendering.
  useEffect(() => {
    const target = focusTarget.current;
    if (!target || designingNow.current) return;
    focusTarget.current = null;
    const el = document.querySelector<HTMLElement>(`[data-field="${target.id}"]`)
      ?? document.querySelector<HTMLElement>('[data-field]');
    el?.focus();
    if (el instanceof HTMLInputElement && el.dataset.field === target.id) {
      try { el.setSelectionRange(target.offset, target.offset); } catch { /* password inputs on some browsers */ }
    }
  });

  // Keyboard: Enter, F1-F24, PageUp/PageDown, Esc = Reset; queued while the host is busy.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While designing, keys belong to the design panel, not the host.
      if (designingNow.current) return;
      if (typingAheadNow.current || awaitingNow.current) {
        const key = typedKey(e);
        if (!key) return;
        e.preventDefault();
        if (queue.current.length < MAX_TYPEAHEAD) {
          queue.current.push(key);
          setQueued(queue.current.length);
        }
        return;
      }
      const action = keyAction(e);
      if (!action) return;
      e.preventDefault();
      if (action === 'Reset') session.send({ type: 'reset' });
      else submit(action);
    };
    // Text that arrives without a usable keydown (mobile keyboards, IMEs, paste).
    const onBeforeInput = (e: InputEvent) => {
      if (!typingAheadNow.current && !awaitingNow.current) return;
      e.preventDefault();
      if (e.inputType !== 'insertText' || !e.data) return;
      for (const ch of e.data) {
        if (queue.current.length < MAX_TYPEAHEAD) queue.current.push({ kind: 'char', ch });
      }
      setQueued(queue.current.length);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeinput', onBeforeInput, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeinput', onBeforeInput, true);
    };
  }, [submit, session]);

  const toggleMode = () => {
    const next = mode === 'modern' ? 'classic' : 'modern';
    setMode(next);
    if (snap) focusTarget.current = caretAtCursor(snap);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* ignore */ }
  };

  // An active pop-up window owns the function keys and the message.
  const keys: FunctionKey[] = (view?.window ? view.window.functionKeys : view?.functionKeys) ?? [];
  const message = view?.window ? view.window.message : view?.message;
  const hasTable = [...(view?.items ?? []), ...(view?.window?.items ?? [])].some((i) => i.kind === 'table');
  const busy = typingAhead;

  return (
    <div className={`app${designing ? ' designing' : ''}`}>
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
          {view?.definition && mode === 'modern' && (
            <span className="custom-badge" title={`Customized: ${view.definition.name}`}>Customized</span>
          )}
          <span className={`status status-${session.state}`}>
            {statusText(session.state, busy)}
            {queued > 0 && <span className="typeahead" title="Keys typed ahead">{queued} typed ahead</span>}
          </span>
          {screens.designer && snap && !designing && (
            <button type="button" className="ghost mode-toggle" onClick={startDesign}>Design</button>
          )}
          {!designing && (
            <button type="button" className="ghost mode-toggle" onClick={toggleMode}>
              {mode === 'modern' ? 'Classic view' : 'Modern view'}
            </button>
          )}
          {session.state !== 'closed' && (
            <button type="button" className="ghost" onClick={session.disconnect}>Disconnect</button>
          )}
        </div>
      </header>

      <main className="stage">
        {message && mode === 'modern' && (
          <div className={`banner banner-${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
            <span>{message.text}</span>
            {message.kind === 'error' && (
              <button type="button" className="ghost" onClick={() => session.send({ type: 'reset' })}>Reset (Esc)</button>
            )}
          </div>
        )}
        <Toast error={notice} />

        {snap && view ? (
          <form className="sheet" onSubmit={(e) => e.preventDefault()} autoComplete="off">
            {mode === 'modern' && view.buttons.length > 0 && (
              <div className="screen-actions">
                {view.buttons.map((b, i) => (
                  <button key={i} type="button" disabled={!canSubmit} onClick={() => onAction(b.action)}>{b.label}</button>
                ))}
              </div>
            )}
            {mode === 'modern'
              ? <ModernScreen view={view} binding={binding} locked={!canSubmit} onAction={onAction}
                  onCursor={(row, col) => { clickedCursor.current = { row, col }; }}
                  design={designing ? { selected: selection?.at ?? null, onSelect: setSelectedAt } : undefined} />
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

      {designing && draft && snap && view && (
        <DesignPanel
          snap={snap}
          view={view}
          draft={draft}
          setDraft={setDraft}
          saved={savedDraft}
          existing={draftExisting}
          selection={selection}
          definitions={screens.screens}
          onPick={pickDefinition}
          onSaved={screens.reload}
          onClose={stopDesign}
        />
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

/** A caret at the end of a field's current value, for correcting it. */
function endOf(snap: ScreenSnapshot, values: Record<string, string>, id: string): Caret {
  const value = values[id] ?? snap.fields.find((f) => f.id === id)?.value ?? '';
  return { id, offset: value.length };
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
    setVisible(error);
    if (!error) return;
    const t = window.setTimeout(() => setVisible(null), 5000);
    return () => window.clearTimeout(t);
  }, [error]);
  return visible ? <div className="toast" role="alert">{visible.message}</div> : null;
}
