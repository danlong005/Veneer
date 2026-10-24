// The designer side panel: edits a draft screen definition that the screen
// previews live, and saves it through /api/screens.

import {
  DATE_FORMATS, ID_PATTERN, ROLES, fingerprint, matches, type DateFormat, type Role, type ScreenDefinition, type Widget,
} from '@veneer/screens';
import type { AidName, ScreenSnapshot } from '@veneer/tn5250';
import { useEffect, useMemo, useState } from 'react';
import type { ScreenView } from '../transform/types.ts';
import {
  addScreenId, buttonsOf, formatOptions, isHidden, originalText, parseOptions, removeScreenId, roleOf, setButtons,
  setHidden, setRole, setText, setWidget, textOf, widgetOf, type Selection,
} from './edit.ts';

const TOKEN_KEY = 'veneer.designerToken';
const AIDS: AidName[] = [
  'Enter', 'PageUp', 'PageDown', 'Help', 'Print',
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}` as AidName),
];

interface Props {
  snap: ScreenSnapshot;
  view: ScreenView;
  draft: ScreenDefinition;
  setDraft: (def: ScreenDefinition) => void;
  /** The saved version of this definition, if it exists on the server. */
  saved: ScreenDefinition | undefined;
  /** True while editing a definition that already existed when design mode began. */
  existing: boolean;
  selection: Selection | null;
  /** All saved definitions, to pick one to edit or extend. */
  definitions: ScreenDefinition[];
  /** Edit a saved definition, or start a new one for this screen (null). */
  onPick: (def: ScreenDefinition | null) => void;
  /** False when the server lets this browser save without the token. */
  tokenRequired: boolean;
  onSaved: () => void;
  onClose: () => void;
}

function loadToken(): string {
  try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

export function DesignPanel(props: Props) {
  const { snap, draft, setDraft, saved, existing, selection, tokenRequired } = props;
  const [token, setToken] = useState(loadToken);
  const canSave = !tokenRequired || token !== '';
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const matched = matches(snap, draft);
  const print = useMemo(() => fingerprint(snap), [snap]);
  const screenIds = draft.match.screenIds ?? [];
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);

  useEffect(() => { setStatus(null); }, [draft]);

  const storeToken = (t: string) => {
    setToken(t);
    try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ }
  };

  async function request(method: 'PUT' | 'DELETE'): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/screens/${encodeURIComponent(draft.id)}`, {
        method,
        headers: {
          ...(tokenRequired ? { Authorization: `Bearer ${token}` } : {}),
          ...(method === 'PUT' ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(method === 'PUT' ? { body: JSON.stringify(draft) } : {}),
      });
      if (res.ok) return true;
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setStatus({ kind: 'error', text: res.status === 401 ? 'Enter a valid designer token.' : body.error ?? `HTTP ${res.status}` });
      return false;
    } catch (err) {
      setStatus({ kind: 'error', text: (err as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const save = async () => {
    if (await request('PUT')) {
      setStatus({ kind: 'ok', text: 'Saved.' });
      props.onSaved();
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete the customization "${draft.name}"?`)) return;
    if (await request('DELETE')) {
      props.onSaved();
      props.onClose();
    }
  };

  const buttons = buttonsOf(draft);
  const idValid = ID_PATTERN.test(draft.id);

  return (
    <aside className="design-panel" aria-label="Screen designer">
      <header className="dp-head">
        <h2>Design</h2>
        <button type="button" className="ghost" onClick={props.onClose}>Done</button>
      </header>

      <section>
        <h3>Customization</h3>
        <select
          className="dp-pick"
          aria-label="Customization to edit"
          value={existing ? draft.id : ''}
          onChange={(e) => props.onPick(props.definitions.find((d) => d.id === e.target.value) ?? null)}
        >
          <option value="">New customization for this screen</option>
          {[...props.definitions].sort((a, b) => a.name.localeCompare(b.name)).map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <label className="dp-row">Name
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="dp-row">File id
          <input
            value={draft.id}
            disabled={existing}
            aria-invalid={!idValid}
            onChange={(e) => setDraft({ ...draft, id: e.target.value.toLowerCase() })}
          />
        </label>
        <label className="dp-row">Page title
          <input
            value={draft.title ?? ''}
            placeholder={props.view.title ?? ''}
            onChange={(e) => {
              const { title: _omit, ...rest } = draft;
              setDraft(e.target.value ? { ...rest, title: e.target.value } : rest);
            }}
          />
        </label>
      </section>

      <section>
        <h3>Recognised by</h3>
        {screenIds.length > 0 && (
          <ul className="dp-list">
            {screenIds.map((sid) => (
              <li key={sid}>
                Screen ID <code>{sid}</code>
                {sid === print.id && <span className="dp-tag">this screen</span>}
                <span className="dp-quote" />
                <button type="button" className="dp-x" aria-label="Remove screen ID" onClick={() => setDraft(removeScreenId(draft, sid))}>×</button>
              </li>
            ))}
          </ul>
        )}
        {!screenIds.includes(print.id) && (
          <button type="button" className="ghost" onClick={() => setDraft(addScreenId(draft, print.id))}>
            Add this screen (ID <code>{print.id}</code>)
          </button>
        )}
        {print.fields === 0 && (
          <p className="dp-hint">This screen has no input fields, so its ID comes from the title alone. Add a text rule if other screens share the title.</p>
        )}
        {draft.match.text.length > 0 && <p className="dp-hint">{screenIds.length > 0 ? 'and this text:' : 'Text:'}</p>}
        <ul className="dp-list">
          {draft.match.text.map((m, i) => (
            <li key={`${m.row}:${m.col}:${i}`}>
              <code>{m.row},{m.col}</code> <span className="dp-quote">“{m.text}”</span>
              <button
                type="button"
                className="dp-x"
                aria-label="Remove match rule"
                onClick={() => setDraft({ ...draft, match: { ...draft.match, text: draft.match.text.filter((_, j) => j !== i) } })}
              >×</button>
            </li>
          ))}
        </ul>
        <p className={matched ? 'dp-ok' : 'dp-warn'}>
          {matched ? '✓ Matches this screen'
            : screenIds.length === 0 && draft.match.text.length === 0 ? 'Add a screen ID or a text rule.'
            : '✗ Does not match this screen'}
        </p>
        {selection?.kind === 'item' && selection.item.kind !== 'table' && (() => {
          const m = originalText(snap, selection.item);
          return m && !draft.match.text.some((x) => x.row === m.row && x.col === m.col) ? (
            <button type="button" className="ghost" onClick={() => setDraft({ ...draft, match: { ...draft.match, text: [...draft.match.text, m] } })}>
              Also require “{m.text}”
            </button>
          ) : null;
        })()}
      </section>

      <section>
        <h3>Selected</h3>
        {selection ? <SelectionEditor draft={draft} setDraft={setDraft} selection={selection} /> : (
          <p className="dp-hint">Click any text, field or table on the screen.</p>
        )}
      </section>

      <section>
        <h3>Buttons</h3>
        {buttons.map((b, i) => (
          <div className="dp-button" key={i}>
            <input
              value={b.label}
              aria-label="Button label"
              onChange={(e) => setDraft(setButtons(draft, buttons.map((x, j) => (j === i ? { ...x, label: e.target.value } : x))))}
            />
            <select
              value={b.action.aid}
              aria-label="Key to press"
              onChange={(e) => setDraft(setButtons(draft, buttons.map((x, j) => (j === i ? { ...x, action: { ...x.action, aid: e.target.value as AidName } } : x))))}
            >
              {AIDS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <button type="button" className="dp-x" aria-label="Remove button" onClick={() => setDraft(setButtons(draft, buttons.filter((_, j) => j !== i)))}>×</button>
          </div>
        ))}
        <button type="button" className="ghost" onClick={() => setDraft(setButtons(draft, [...buttons, { label: 'New button', action: { aid: 'Enter' } }]))}>
          Add button
        </button>
      </section>

      <footer className="dp-foot">
        {tokenRequired && (
          <>
            {!token && <p className="dp-hint">Saving needs the designer token (VENEER_DESIGNER_TOKEN).</p>}
            <label className="dp-row">Designer token
              <input type="password" value={token} autoComplete="off" onChange={(e) => storeToken(e.target.value)} />
            </label>
          </>
        )}
        {status && <p className={status.kind === 'ok' ? 'dp-ok' : 'dp-warn'} role="status">{status.text}</p>}
        <div className="dp-actions">
          <button type="button" className="primary" disabled={busy || !dirty || !idValid || (screenIds.length === 0 && draft.match.text.length === 0) || !canSave} onClick={save}>
            {saved ? 'Save changes' : 'Save'}
          </button>
          {saved && <button type="button" className="ghost" disabled={busy || !dirty} onClick={() => setDraft(saved)}>Revert</button>}
          {saved && <button type="button" className="ghost danger" disabled={busy || !canSave} onClick={remove}>Delete</button>}
        </div>
      </footer>
    </aside>
  );
}

function SelectionEditor({ draft, setDraft, selection }: { draft: ScreenDefinition; setDraft: (d: ScreenDefinition) => void; selection: Selection }) {
  const at = selection.at;
  const hidden = isHidden(draft, at);
  const hideToggle = (
    <label className="dp-check">
      <input type="checkbox" checked={hidden} onChange={(e) => setDraft(setHidden(draft, at, e.target.checked))} /> Hide
    </label>
  );

  if (selection.kind === 'field') {
    const f = selection.field;
    const widget = widgetOf(draft, f.id);
    return (
      <>
        <p className="dp-desc">Input field <code>{f.id}</code>, {f.length} character{f.length === 1 ? '' : 's'}{f.value ? ` (now “${f.value}”)` : ''}</p>
        {hideToggle}
        <label className="dp-row">Show as
          <select
            value={widget?.type ?? 'text'}
            onChange={(e) => setDraft(setWidget(draft, f.id, defaultWidget(e.target.value, f.value)))}
          >
            <option value="text">Text box</option>
            <option value="select">Dropdown</option>
            <option value="checkbox">Checkbox</option>
            <option value="date">Date picker</option>
          </select>
        </label>
        {widget && <WidgetEditor key={`${f.id}:${widget.type}`} widget={widget} onChange={(w) => setDraft(setWidget(draft, f.id, w))} />}
      </>
    );
  }

  const item = selection.item;
  const kind = item.kind === 'text' ? 'Text' : item.kind === 'link' ? 'Menu link' : item.kind === 'table' ? 'Table' : 'Field';
  const original = item.kind === 'text' || item.kind === 'link' ? item.text : '';
  return (
    <>
      <p className="dp-desc">{kind} at <code>{at.row},{at.col}</code>{original ? `: “${original}”` : ''}</p>
      {hideToggle}
      {(item.kind === 'text' || item.kind === 'link') && (
        <label className="dp-row">Text
          <input
            value={textOf(draft, at) ?? ''}
            placeholder={original}
            onChange={(e) => setDraft(setText(draft, at, e.target.value === '' ? null : e.target.value))}
          />
        </label>
      )}
      {item.kind === 'text' && (
        <label className="dp-row">Style
          <select value={roleOf(draft, at) ?? ''} onChange={(e) => setDraft(setRole(draft, at, (e.target.value || null) as Role | null))}>
            <option value="">As on the host</option>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </label>
      )}
    </>
  );
}

const ROLE_LABELS: Record<Role, string> = {
  normal: 'Normal', emphasis: 'Bold', muted: 'Muted', danger: 'Error', warning: 'Warning', accent: 'Accent', accent2: 'Highlight',
};

function defaultWidget(type: string, value: string): Widget | null {
  switch (type) {
    case 'select': return { type: 'select', options: value ? [{ value, label: value }] : [] };
    case 'checkbox': return { type: 'checkbox', on: 'Y', off: 'N' };
    case 'date': return { type: 'date', format: 'YYYYMMDD' };
    default: return null;
  }
}

function WidgetEditor({ widget, onChange }: { widget: Widget; onChange: (w: Widget) => void }) {
  // Keep the options text as typed; parse it on every change.
  const [optionsText, setOptionsText] = useState(widget.type === 'select' ? formatOptions(widget.options) : '');
  switch (widget.type) {
    case 'select':
      return (
        <label className="dp-row">Choices, one per line as value=Label
          <textarea
            rows={5}
            value={optionsText}
            onChange={(e) => {
              setOptionsText(e.target.value);
              onChange({ type: 'select', options: parseOptions(e.target.value) });
            }}
          />
        </label>
      );
    case 'checkbox':
      return (
        <div className="dp-pair">
          <label className="dp-row">Checked value<input value={widget.on} onChange={(e) => onChange({ ...widget, on: e.target.value })} /></label>
          <label className="dp-row">Unchecked value<input value={widget.off} onChange={(e) => onChange({ ...widget, off: e.target.value })} /></label>
        </div>
      );
    case 'date':
      return (
        <label className="dp-row">Host date format
          <select value={widget.format} onChange={(e) => onChange({ type: 'date', format: e.target.value as DateFormat })}>
            {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
      );
  }
}
