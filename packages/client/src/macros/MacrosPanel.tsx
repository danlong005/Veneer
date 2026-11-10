// The Macros panel: record a macro by using the application, edit its steps
// (values, parameters, optional steps, order), test it from the screen you are
// on, and save it to screens/macros on the server. Beside the live screen, not
// in design mode, so recording and testing drive the host as a user would.

import { DefinitionError, paramsIn, screenId, stepMatches, validateMacro, type Macro, type MacroStep } from '@veneer/screens';
import type { AidName, HostType, ScreenSnapshot } from '@veneer/terminal';
import { useEffect, useMemo, useState } from 'react';
import { loadToken, storeToken } from '../designer/token.ts';
import type { ScreenView } from '@veneer/view';
import { buttonAids, keyHint } from '../ui/keys.ts';
import { ChecksEditor } from './ChecksEditor.tsx';
import {
  addOutput, checksOf, deepLink, endAnywhere, endHere, makeParameter, moveStep, nameFor, newMacro, paramNameProblem, removeParameter, removeStep,
  setChecks, setOutput, setStep, unusedParams, type RecordedChecks,
} from './edit.ts';

interface Props {
  snap: ScreenSnapshot;
  view: ScreenView;
  macros: Macro[];
  host: HostType;
  tokenRequired: boolean;
  /** Steps recorded so far while recording; null when not recording. */
  recorded: MacroStep[] | null;
  onRecord: (on: boolean) => void;
  /** Checks added while recording, on the screen they were added on. */
  recordedChecks: RecordedChecks | null;
  onRecordChecks: (checks: RecordedChecks | null) => void;
  /** Pick a position on the screen for a check; null when the screen can't be picked on (the classic view). */
  onPick: ((done: (at: { row: number; col: number }) => void) => void) | null;
  /** A pick is waiting for a click. */
  picking: boolean;
  /** A macro is running (a test, or Go to). */
  running: boolean;
  onTest: (macro: Macro, values: Record<string, string>) => void;
  onSaved: () => void;
  onClose: () => void;
}

export function MacrosPanel(props: Props) {
  const { macros, host, recorded, snap } = props;
  const [token, setToken] = useState(loadToken);
  const canSave = !props.tokenRequired || token !== '';
  /** The saved macro being edited (its name when opened), or null for a new one. */
  const [openName, setOpenName] = useState<string | null>(null);
  const saved = openName ? macros.find((m) => m.name === openName) : undefined;
  const [draft, setDraft] = useState<Macro | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [testValues, setTestValues] = useState<Record<string, string>>({});
  const [naming, setNaming] = useState<{ step: number; field: string; name: string } | null>(null);
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved ?? null);
  useEffect(() => { setStatus(null); }, [draft]);

  const confirmDiscard = () => !dirty || window.confirm('Discard unsaved changes to this macro?');
  const open = (name: string) => {
    if (!confirmDiscard()) return;
    const m = macros.find((x) => x.name === name);
    setOpenName(m ? m.name : null);
    setDraft(m ? structuredClone(m) : null);
    setTestValues({});
    setNaming(null);
  };
  const startRecording = () => {
    if (!confirmDiscard()) return;
    setOpenName(null);
    setDraft(null);
    props.onRecord(true);
  };
  const stopRecording = () => {
    const steps = recorded ?? [];
    // Checks on the screen it stopped on: the screen the macro must end on.
    const pending = props.recordedChecks;
    const end = pending && pending.screen === screenId(snap) && pending.expect.length > 0
      ? { screen: pending.screen, ...(pending.title ? { title: pending.title } : {}), expect: pending.expect } : undefined;
    props.onRecord(false);
    props.onRecordChecks(null);
    if (steps.length > 0) setDraft(newMacro(steps, host, macros.map((m) => m.name), end));
  };

  // What is wrong with the draft, as the server would say it.
  const problem = useMemo(() => {
    if (!draft) return null;
    try { validateMacro(draft); return null; } catch (err) { return err instanceof DefinitionError ? err.message : String(err); }
  }, [draft]);
  const nameTaken = draft !== null && draft.name !== openName && macros.some((m) => m.name === draft.name);

  async function request(method: 'PUT' | 'DELETE', name: string, body?: Macro): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/macros/${encodeURIComponent(name)}`, {
        method,
        headers: { ...(props.tokenRequired ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (res.ok) return true;
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setStatus({ kind: 'error', text: res.status === 401 ? 'Enter a valid designer token.' : err.error ?? `HTTP ${res.status}` });
      return false;
    } catch (err) {
      setStatus({ kind: 'error', text: (err as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  }
  const save = async () => {
    if (!draft || problem || nameTaken) return;
    if (!(await request('PUT', draft.name, draft))) return;
    // Renamed: the file under the old name goes.
    if (openName && openName !== draft.name) await request('DELETE', openName);
    setOpenName(draft.name);
    setStatus({ kind: 'ok', text: 'Saved.' });
    props.onSaved();
  };
  const remove = async () => {
    if (!openName || !window.confirm(`Delete the macro “${saved?.label ?? openName}”?`)) return;
    if (!(await request('DELETE', openName))) return;
    setOpenName(null);
    setDraft(null);
    props.onSaved();
  };
  const test = () => {
    if (!draft || problem) return;
    props.onTest(draft, testValues);
  };

  const keys = buttonAids(host);
  const params = Object.entries(draft?.params ?? {});
  const outputs = Object.entries(draft?.output ?? {});
  const unused = draft ? unusedParams(draft) : [];
  const hereId = screenId(snap);
  const hereTitle = props.view.window?.title ?? props.view.title;
  const pendingChecks = props.recordedChecks?.screen === hereId ? props.recordedChecks.expect : [];
  const end = draft?.end;
  const endIsHere = end?.screen ? stepMatches({ screen: end.screen, ...(end.text ? { text: end.text } : {}), press: 'Enter' }, snap, hereId) : true;
  const link = draft ? deepLink(draft, location.origin, testValues) : '';

  return (
    <aside className="design-panel macros-panel" aria-label="Macros">
      <header className="dp-head">
        <h2>Macros</h2>
        <div className="dp-head-actions">
          <button type="button" className="ghost" onClick={() => { if (confirmDiscard()) props.onClose(); }}>Done</button>
        </div>
      </header>
      <div className="dp-body">
        <section>
          <label className="dp-row">Macro
            <select value={openName ?? ''} disabled={recorded !== null} onChange={(e) => open(e.target.value)}>
              <option value="">{draft && !openName ? `${draft.label} (not saved)` : 'Choose a macro…'}</option>
              {macros.map((m) => <option key={m.name} value={m.name}>{m.label}</option>)}
            </select>
          </label>
          {recorded === null ? (
            <>
              <p className="dp-hint">Record a new macro: use the application as usual, from the screen it should start on. Each key you press becomes a step; passwords are never recorded.</p>
              <div className="dp-actions"><button type="button" className="primary" disabled={props.running} onClick={startRecording}>Record</button></div>
            </>
          ) : (
            <>
              <p className="dp-recording" role="status"><span className="dp-rec-dot" aria-hidden /> Recording: {recorded.length} {recorded.length === 1 ? 'step' : 'steps'}</p>
              <ol className="dp-list macro-steps-brief">
                {recorded.map((s, i) => (
                  <li key={i}>{s.title ?? s.screen} <kbd>{keyHint(s.press, host)}</kbd>
                    {s.expect?.length ? <span className="dp-hint"> {s.expect.length === 1 ? '1 check' : `${s.expect.length} checks`}</span> : null}</li>
                ))}
              </ol>
              <h3>Checks on this screen</h3>
              <p className="dp-hint">What this screen must show when the macro runs. They are made before the key you press next, or, if you stop here, on the screen the macro must end on.</p>
              <ChecksEditor checks={pendingChecks} snap={snap} here name="this screen" onPick={props.onPick} picking={props.picking}
                onChange={(expect) => props.onRecordChecks({ screen: hereId, ...(hereTitle ? { title: hereTitle } : {}), expect })} />
              <div className="dp-actions"><button type="button" className="primary" onClick={stopRecording}>Stop</button></div>
            </>
          )}
        </section>

        {draft && recorded === null && (
          <>
            <section>
              <h3>Macro</h3>
              <label className="dp-row">Name people see
                <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value, ...(!openName ? { name: nameFor(e.target.value) } : {}) })} />
              </label>
              <label className="dp-row">Name in links and files
                <input value={draft.name} aria-invalid={nameTaken} spellCheck={false} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              {nameTaken && <p className="dp-warn">Another macro has this name.</p>}
              <label className="dp-check">
                <input type="checkbox" checked={draft.menu ?? false} onChange={(e) => setDraft(e.target.checked ? { ...draft, menu: true } : (({ menu: _m, ...rest }) => rest)(draft))} />
                List under Go to in the page header
              </label>
              <label className="dp-check">
                <input type="checkbox" checked={draft.api ?? false} onChange={(e) => setDraft(e.target.checked ? { ...draft, api: true } : (({ api: _a, ...rest }) => rest)(draft))} />
                Other systems can run it (macro API)
              </label>
            </section>

            {draft.api && (
              <section>
                <h3>API results</h3>
                <p className="dp-hint">Values to read from the screen the macro ends on, by the name callers get them under: a field, or text at a position (to the next wide gap). Every field, the list (all pages) and the messages come back too.</p>
                {outputs.map(([name, at], k) => (
                  <div key={k} className="macro-field">
                    <input value={name} aria-label="Name callers get it under" spellCheck={false} placeholder="name"
                      onChange={(e) => setDraft(setOutput(draft, k, e.target.value, at))} />
                    <input value={at} aria-label={`Position of ${name}`} spellCheck={false} placeholder="row:col" size={7}
                      onChange={(e) => setDraft(setOutput(draft, k, name, e.target.value))} />
                    <button type="button" className="ghost danger" aria-label={`Remove ${name}`} onClick={() => setDraft(setOutput(draft, k, null, ''))}>✕</button>
                  </div>
                ))}
                <div className="dp-actions">
                  <button type="button" title="A value at the cursor's position on this screen" onClick={() => setDraft(addOutput(draft, `${snap.cursor.row}:${snap.cursor.col}`))}>Add value at cursor</button>
                </div>
                <label className="dp-row">Run it with
                  <input readOnly value={`POST ${location.origin}/api/run/${draft.name}`} onFocus={(e) => e.target.select()} />
                </label>
              </section>
            )}

            <section>
              <h3>Values</h3>
              {params.length === 0 && <p className="dp-hint">A value the macro is given when it starts, such as an order number. Turn a typed value into one with Make value, below.</p>}
              {params.map(([name, p]) => (
                <div key={name} className="macro-param">
                  <div className="macro-param-head">
                    <code>{`{${name}}`}</code>
                    {unused.includes(name) && <span className="dp-hint">not used</span>}
                    <button type="button" className="ghost" title="Put the value back as typed text" onClick={() => setDraft(removeParameter(draft, name, testValues[name] ?? ''))}>Remove</button>
                  </div>
                  <label className="dp-row">Called
                    <input value={p.label ?? ''} placeholder={name} onChange={(e) => setDraft({ ...draft, params: { ...draft.params, [name]: { ...p, label: e.target.value } } })} />
                  </label>
                  <label className="dp-row">Allowed (regular expression)
                    <input value={p.pattern ?? ''} placeholder="Anything" spellCheck={false} onChange={(e) => setDraft({ ...draft, params: { ...draft.params, [name]: e.target.value ? { ...p, pattern: e.target.value } : (({ pattern: _x, ...rest }) => rest)(p) } })} />
                  </label>
                  <label className="dp-check">
                    <input type="checkbox" checked={p.required ?? false} onChange={(e) => setDraft({ ...draft, params: { ...draft.params, [name]: e.target.checked ? { ...p, required: true } : (({ required: _r, ...rest }) => rest)(p) } })} />
                    Required
                  </label>
                </div>
              ))}
            </section>

            <section>
              <h3>Steps</h3>
              <ol className="macro-steps">
                {draft.steps.map((s, i) => (
                  <li key={i} className={stepMatches(s, snap, hereId) ? 'here' : undefined}>
                    <div className="macro-step-head">
                      <span className="macro-step-title" title={`Screen ${s.screen}`}>{s.title ?? `Screen ${s.screen.slice(0, 8)}`}</span>
                      {stepMatches(s, snap, hereId) && <span className="dp-hint">this screen</span>}
                      <button type="button" className="ghost" aria-label="Move up" disabled={i === 0} onClick={() => setDraft(moveStep(draft, i, -1))}>↑</button>
                      <button type="button" className="ghost" aria-label="Move down" disabled={i === draft.steps.length - 1} onClick={() => setDraft(moveStep(draft, i, 1))}>↓</button>
                      <button type="button" className="ghost danger" aria-label="Delete step" onClick={() => setDraft(removeStep(draft, i))}>✕</button>
                    </div>
                    {Object.entries(s.fields ?? {}).map(([id, value]) => (
                      <div key={id} className="macro-field">
                        <code>{id}</code>
                        <input value={value} aria-label={`Value typed at ${id}`} spellCheck={false}
                          onChange={(e) => setDraft(setStep(draft, i, { ...s, fields: { ...s.fields, [id]: e.target.value } }))} />
                        {paramsIn(value).length === 0 && (
                          <button type="button" className="ghost" title="Give this value when the macro starts" onClick={() => setNaming({ step: i, field: id, name: '' })}>Make value</button>
                        )}
                        {naming?.step === i && naming.field === id && (
                          <ParamNamer macro={draft} naming={naming} setNaming={setNaming} onDone={(name) => {
                            setTestValues((v) => ({ ...v, [name]: value }));
                            setDraft(makeParameter(draft, i, id, name));
                            setNaming(null);
                          }} />
                        )}
                      </div>
                    ))}
                    {(s.expect?.length || stepMatches(s, snap, hereId)) ? (
                      <details className="macro-step-checks" open={Boolean(s.expect?.length)}>
                        <summary>{s.expect?.length ? `Checks (${s.expect.length})` : 'Checks'}</summary>
                        <ChecksEditor checks={checksOf(draft, i)} snap={snap} here={stepMatches(s, snap, hereId)} name={`step ${i + 1}`}
                          onPick={props.onPick} picking={props.picking} onChange={(checks) => setDraft(setChecks(draft, i, checks))} />
                      </details>
                    ) : null}
                    <div className="macro-step-foot">
                      <label className="dp-inline">Then press
                        <select value={s.press} onChange={(e) => setDraft(setStep(draft, i, { ...s, press: e.target.value as AidName }))}>
                          {(keys.includes(s.press) ? keys : [s.press, ...keys]).map((k) => <option key={k} value={k}>{keyHint(k, host)}</option>)}
                        </select>
                      </label>
                      <label className="dp-check" title="The screen only sometimes appears, such as Display Program Messages: when it doesn't, carry on">
                        <input type="checkbox" checked={s.optional ?? false} onChange={(e) => setDraft(setStep(draft, i, e.target.checked ? { ...s, optional: true } : (({ optional: _o, ...rest }) => rest)(s)))} />
                        Only sometimes
                      </label>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section>
              <h3>End</h3>
              <p className="dp-hint">What the screen the macro ends on must show, which makes it a test: a run fails if a check fails. Checks on a step, above, are made on its screen before anything is typed.</p>
              <div className="macro-field">
                <span className="macro-end-screen">
                  {end?.screen ? <>Must end on <strong>{end.title ?? `screen ${end.screen.slice(0, 8)}`}</strong>{endIsHere && <span className="dp-hint"> (this screen)</span>}</> : 'Can end on any screen'}
                </span>
                {end?.screen
                  ? <button type="button" className="ghost" onClick={() => setDraft(endAnywhere(draft))}>Any screen</button>
                  : <button type="button" className="ghost" title="The screen showing now" onClick={() => setDraft(endHere(draft, snap, hereTitle))}>Must end on this screen</button>}
              </div>
              <ChecksEditor checks={checksOf(draft, 'end')} snap={snap} here={endIsHere} name="the end"
                onPick={props.onPick} picking={props.picking} onChange={(checks) => setDraft(setChecks(draft, 'end', checks))} />
            </section>

            <section>
              <h3>Test</h3>
              <p className="dp-hint">Runs from the screen you are on, starting at the first step for it. Esc stops it.</p>
              {params.map(([name, p]) => (
                <label key={name} className="dp-row">{p.label ?? name}
                  <input value={testValues[name] ?? ''} onChange={(e) => setTestValues((v) => ({ ...v, [name]: e.target.value }))} />
                </label>
              ))}
              <div className="dp-actions"><button type="button" disabled={Boolean(problem) || props.running} onClick={test}>Test</button></div>
              <label className="dp-row">Link that starts it in a new session
                <input readOnly value={link} onFocus={(e) => e.target.select()} />
              </label>
            </section>
          </>
        )}
      </div>
      <footer className="dp-foot">
        {props.tokenRequired && (
          <label className="dp-row dp-token">Designer token
            <input type="password" value={token} autoComplete="off" onChange={(e) => { setToken(e.target.value); storeToken(e.target.value); }} />
          </label>
        )}
        {draft && problem && <p className="dp-warn" role="status">{problem}</p>}
        {status && <p className={status.kind === 'ok' ? 'dp-ok' : 'dp-warn'} role="status">{status.text}</p>}
        {draft && recorded === null && (
          <div className="dp-actions">
            <button type="button" className="primary" disabled={busy || !dirty || Boolean(problem) || nameTaken || !canSave} onClick={save}>{saved ? 'Save changes' : 'Save'}</button>
            {saved && <button type="button" className="ghost" disabled={busy || !dirty} onClick={() => setDraft(structuredClone(saved))}>Revert</button>}
            {saved && <button type="button" className="ghost danger" disabled={busy || !canSave} onClick={remove}>Delete</button>}
          </div>
        )}
      </footer>
    </aside>
  );
}

/** Naming a new value (parameter) for a typed value. */
function ParamNamer({ macro, naming, setNaming, onDone }: {
  macro: Macro;
  naming: { step: number; field: string; name: string };
  setNaming: (n: { step: number; field: string; name: string } | null) => void;
  onDone: (name: string) => void;
}) {
  const problem = naming.name ? paramNameProblem(macro, naming.name) : undefined;
  return (
    <form className="macro-namer" onSubmit={(e) => { e.preventDefault(); if (naming.name && !problem) onDone(naming.name); }}>
      <input autoFocus placeholder="Name, e.g. order" value={naming.name} aria-invalid={Boolean(problem)} spellCheck={false}
        onChange={(e) => setNaming({ ...naming, name: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setNaming(null); } }} />
      <button type="submit" className="ghost" disabled={!naming.name || Boolean(problem)}>OK</button>
      {problem && <span className="dp-warn">{problem}</span>}
    </form>
  );
}
