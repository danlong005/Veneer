// The checks on one screen of a macro (a step's expect, or its end), in the
// Macros panel: what each reads, how it tests it, and, while that screen is
// showing, whether it passes now. New checks are picked on the screen.

import { runCheck, type MacroCheck } from '@veneer/screens';
import type { ScreenSnapshot } from '@veneer/terminal';
import { screenMessage } from '@veneer/view';
import { checkAt, messageCheck, setTest, testOf, type CheckTest } from './edit.ts';

/** How a check tests its value, as one choice: the test, and whether it is negated. */
const TESTS: Array<{ value: string; label: string; test: CheckTest; not: boolean }> = [
  { value: 'equals', label: 'is', test: 'equals', not: false },
  { value: 'not-equals', label: 'is not', test: 'equals', not: true },
  { value: 'contains', label: 'contains', test: 'contains', not: false },
  { value: 'not-contains', label: 'doesn\'t contain', test: 'contains', not: true },
  { value: 'matches', label: 'matches', test: 'matches', not: false },
  { value: 'not-matches', label: 'doesn\'t match', test: 'matches', not: true },
];

const testValue = (c: MacroCheck) => `${c.not ? 'not-' : ''}${testOf(c)}`;

interface Props {
  checks: MacroCheck[];
  onChange: (checks: MacroCheck[]) => void;
  /** The screen showing now. */
  snap: ScreenSnapshot;
  /** The screen showing is the one these checks are made on: they show whether they pass, and new ones are picked on it. */
  here: boolean;
  /** Start picking a position on the screen; the callback gets it. Null when the screen can't be picked on. */
  onPick: ((done: (at: { row: number; col: number }) => void) => void) | null;
  picking: boolean;
  /** What the checks are for, for screen readers: "step 2", "the end". */
  name: string;
}

export function ChecksEditor({ checks, onChange, snap, here, onPick, picking, name }: Props) {
  const set = (k: number, c: MacroCheck) => onChange(checks.map((x, i) => (i === k ? c : x)));
  const add = (c: MacroCheck) => onChange([...checks, c]);
  return (
    <div className="macro-checks">
      {checks.map((c, k) => {
        const test = testOf(c);
        const now = here ? safeCheck(c, snap) : null;
        return (
          <div key={k} className="macro-check">
            <div className="macro-check-line">
              {c.message
                ? <span className="macro-check-what">Message</span>
                : <input className="macro-check-at" value={c.at ?? ''} size={6} spellCheck={false} aria-label={`Position checked (${name}, check ${k + 1})`}
                    onChange={(e) => set(k, { ...c, at: e.target.value })} />}
              <input className="macro-check-label" value={c.label ?? ''} placeholder={c.message ? 'The message' : 'Name in results'} aria-label={`Name of check ${k + 1} (${name})`}
                onChange={(e) => { const { label: _l, ...rest } = c; set(k, e.target.value ? { ...rest, label: e.target.value } : rest); }} />
              <button type="button" className="ghost danger" aria-label={`Remove check ${k + 1} (${name})`} onClick={() => onChange(checks.filter((_, i) => i !== k))}>✕</button>
            </div>
            <div className="macro-check-line">
              <select value={testValue(c)} aria-label={`Test of check ${k + 1} (${name})`} onChange={(e) => {
                const t = TESTS.find((x) => x.value === e.target.value)!;
                const { not: _n, ...rest } = setTest(c, t.test);
                set(k, t.not ? { ...rest, not: true } : rest);
              }}>
                {TESTS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <input className="macro-check-value" value={c[test] ?? ''} spellCheck={false}
                placeholder={test === 'equals' ? 'blank' : test === 'matches' ? 'regular expression' : 'text'} aria-label={`Value of check ${k + 1} (${name})`}
                onChange={(e) => set(k, setTest(c, test, e.target.value))} />
            </div>
            {now && (
              <p className={now.passed ? 'macro-check-now pass' : 'macro-check-now fail'}>
                {now.passed ? '✓ Passes' : '✗ Fails'} here: {now.actual === '' ? 'blank' : `“${now.actual}”`}
              </p>
            )}
          </div>
        );
      })}
      {here ? (
        <div className="dp-actions">
          <button type="button" disabled={!onPick || picking} title="Then click a value on the screen"
            onClick={() => onPick?.((at) => add(checkAt(snap, at)))}>{picking ? 'Click a value on the screen…' : 'Check a value'}</button>
          <button type="button" title="That the message line says what it says now, or that there is none"
            onClick={() => add(messageCheck(screenMessage(snap)))}>Check the message</button>
        </div>
      ) : (
        <div className="dp-actions">
          <button type="button" className="ghost" title="Go to this screen to pick values on it" onClick={() => add({ at: '1:1', equals: '' })}>Add a check</button>
        </div>
      )}
    </div>
  );
}

/** The check made on the screen showing; null while it is being edited into something invalid (a broken regular expression). */
function safeCheck(c: MacroCheck, snap: ScreenSnapshot) {
  if (!c.message && !/^\d{1,3}:\d{1,3}$/.test(c.at ?? '')) return null;
  try { return runCheck(c, snap, screenMessage); } catch { return null; }
}
