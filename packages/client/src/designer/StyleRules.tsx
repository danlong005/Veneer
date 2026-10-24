// The designer's Styles section: conditional styling rules, such as "rows
// whose Status is MSGW in red". Each rule shows how much of this screen it
// matches, so the designer can see it working.

import { ROLES, STYLE_TESTS, conditionTester, testOf, type Role, type ScreenDefinition, type StyleCondition, type StyleTarget, type StyleTest, type Target } from '@veneer/screens';
import type { Item, ScreenView } from '../transform/types.ts';
import { itemAt } from '../transform/customize.ts';
import { ROLE_LABELS, setStyles, stylesOf, type StyleRule } from './edit.ts';

const TEST_LABELS: Record<StyleTest, string> = {
  equals: 'is', contains: 'contains', matches: 'matches pattern', lessThan: 'is less than', greaterThan: 'is more than',
};

interface Props {
  draft: ScreenDefinition;
  setDraft: (d: ScreenDefinition) => void;
  view: ScreenView;
  /** The position selected on the screen, for rules about one item. */
  selected: Target | undefined;
}

export function StyleRules({ draft, setDraft, view, selected }: Props) {
  const rules = stylesOf(draft);
  const items = [...view.items, ...(view.window?.items ?? [])];
  const headings = [...new Set(items.flatMap((i) => (i.kind === 'table' ? i.columns.map((c) => c.header.trim()) : [])).filter(Boolean))];
  const setRule = (i: number, rule: StyleRule) => setDraft(setStyles(draft, rules.map((r, j) => (j === i ? rule : r))));

  const add = () => {
    const when: StyleCondition = headings[0] ? { column: headings[0], equals: '' } : { at: selected ?? { row: 1, col: 1 }, equals: '' };
    setDraft(setStyles(draft, [...rules, { when, role: 'danger', target: when.column !== undefined ? 'row' : 'item' }]));
  };

  return (
    <section>
      <h3>Styles</h3>
      {rules.length === 0 && (
        <p className="dp-hint">Highlight rows, cells or items by their value, such as a job whose Status is MSGW.</p>
      )}
      {rules.map((rule, i) => {
        const { test, value } = testOf(rule.when);
        const subject = rule.when.column !== undefined ? `column:${rule.when.column}` : `at:${rule.when.at!.row}:${rule.when.at!.col}`;
        const subjects = [
          ...headings.map((h) => `column:${h}`),
          ...(rule.when.column !== undefined && !headings.includes(rule.when.column) ? [subject] : []),
          ...(rule.when.at ? [subject] : []),
          ...(selected && subject !== `at:${selected.row}:${selected.col}` ? [`at:${selected.row}:${selected.col}`] : []),
        ];
        const setWhen = (when: StyleCondition, target: StyleTarget = rule.target) => setRule(i, { ...rule, when, target });
        const withSubject = (s: string): StyleCondition => {
          const [kind, a, b] = s.split(':') as [string, string, string?];
          const base: StyleCondition = kind === 'column' ? { column: s.slice('column:'.length) } : { at: { row: Number(a), col: Number(b) } };
          return { ...base, [test]: value };
        };
        const withTest = (t: StyleTest, v: string): StyleCondition => {
          const { column, at } = rule.when;
          const numeric = t === 'lessThan' || t === 'greaterThan';
          // A number test keeps the text until it reads as a number; saving reports it.
          const parsed = numeric && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v;
          return { ...(column !== undefined ? { column } : { at: at! }), [t]: parsed };
        };
        const count = matchCount(items, rule);
        return (
          <div className="dp-style" key={i}>
            <select
              value={subject} aria-label="What to check"
              onChange={(e) => {
                const when = withSubject(e.target.value);
                setWhen(when, when.column !== undefined ? (rule.target === 'item' ? 'row' : rule.target) : 'item');
              }}
            >
              {subjects.map((s) => <option key={s} value={s}>{subjectLabel(s)}</option>)}
            </select>
            <button type="button" className="dp-x" aria-label="Remove style" onClick={() => setDraft(setStyles(draft, rules.filter((_, j) => j !== i)))}>×</button>
            <select value={test} aria-label="Test" onChange={(e) => setWhen(withTest(e.target.value as StyleTest, String(value)))}>
              {STYLE_TESTS.map((t) => <option key={t} value={t}>{TEST_LABELS[t]}</option>)}
            </select>
            <input value={String(value)} aria-label="Value" spellCheck={false} onChange={(e) => setWhen(withTest(test, e.target.value))} />
            <select value={rule.role} aria-label="Style" onChange={(e) => setRule(i, { ...rule, role: e.target.value as Role })}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            {rule.when.column !== undefined ? (
              <select value={rule.target} aria-label="Apply to" onChange={(e) => setRule(i, { ...rule, target: e.target.value as StyleTarget })}>
                <option value="row">whole row</option>
                <option value="cell">this cell</option>
              </select>
            ) : <span className="dp-hint">this item</span>}
            <p className="dp-preview">{count}</p>
          </div>
        );
      })}
      <button type="button" className="ghost" onClick={add}>Add style</button>
    </section>
  );
}

function subjectLabel(s: string): string {
  return s.startsWith('column:') ? `Column “${s.slice('column:'.length)}”` : `Item at ${s.slice('at:'.length)}`;
}

/** How much of the current screen a rule matches, as a short sentence. */
function matchCount(items: Item[], rule: StyleRule): string {
  let passes: (text: string) => boolean;
  try {
    passes = conditionTester(rule.when);
  } catch {
    return 'Not a valid pattern.';
  }
  const { test, value } = testOf(rule.when);
  if ((test === 'lessThan' || test === 'greaterThan') && typeof value !== 'number') return 'Enter a number.';
  if (rule.when.at) {
    const item = itemAt(items, rule.when.at);
    const text = item?.kind === 'text' ? item.text : item?.kind === 'field' ? item.field.value : undefined;
    if (text === undefined) return 'No text or field at that position.';
    return passes(text) ? 'Matches on this screen.' : 'Does not match on this screen.';
  }
  const heading = rule.when.column!.trim().toLowerCase();
  let rows = 0, matched = 0;
  for (const t of items) {
    if (t.kind !== 'table') continue;
    const k = t.columns.findIndex((c) => c.header.trim().toLowerCase() === heading);
    if (k < 0) continue;
    for (const r of t.rows) {
      rows++;
      const cell = r.cells[k];
      if (cell && passes(cell.field?.value ?? cell.text)) matched++;
    }
  }
  if (rows === 0) return 'No list with that column on this screen.';
  return `Matches ${matched} of ${rows} rows on this screen.`;
}
