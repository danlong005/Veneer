// The preview of a paste (paste.ts): what goes in which field, and what
// stopped it, before anything is typed. Nothing is sent to the host; the
// values become edits, as if typed, and Enter is still the user's to press.

import type { PastePlan } from './paste.ts';
import { problemText } from './paste.ts';

const PREVIEW_ROWS = 50;

export function PasteDialog({ plan, onPaste, onCancel }: { plan: PastePlan; onPaste: () => void; onCancel: () => void }) {
  const count = Object.keys(plan.edits).length;
  const problem = problemText(plan);
  const shown = plan.rows.slice(0, PREVIEW_ROWS);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="paste-title" onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
      <form className="dialog paste-dialog" onSubmit={(e) => { e.preventDefault(); onPaste(); }}>
        <h2 id="paste-title">Paste {plan.kind === 'fields' ? `into ${plural(plan.columns.length, 'field')}` : plural(plan.rows.length, 'row')}</h2>
        <div className="paste-preview">
          <table>
            <thead>
              <tr>
                {plan.kind !== 'fields' && <th scope="col"><span className="paste-sr">Row</span></th>}
                {plan.columns.map((t, j) => <th key={j} scope="col">{t ? t.name : '—'}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, i) => (
                <tr key={i}>
                  {plan.kind !== 'fields' && <th scope="row">{i + 1}</th>}
                  {plan.columns.map((_, j) => {
                    if (plan.problem && plan.problem.row === i + 1 && plan.problem.col === j + 1) {
                      return <td key={j} className="bad" title={plan.problem.message}>{plan.problem.cell}</td>;
                    }
                    const v = row[j];
                    return <td key={j} className={v === null || v === undefined ? 'unchanged' : undefined}>{v === null || v === undefined ? '' : v.trimEnd() || ' '}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {plan.rows.length > shown.length && <p className="paste-hint">And {plural(plan.rows.length - shown.length, 'more row')}.</p>}
        </div>
        {problem && <p className="paste-problem" role="alert">It stops here. {problem}{count > 0 ? ' The cells before it are pasted.' : ''}</p>}
        {plan.extraRows > 0 && <p className="paste-hint">This screen has room for {plural(plan.rows.length, 'row')} from here; the other {plural(plan.extraRows, 'row')} aren't pasted. Press Enter or Page Down, then paste them on the next page.</p>}
        {plan.extraCols > 0 && <p className="paste-hint">{plural(plan.extraCols, 'column')} at the right {plan.extraCols === 1 ? 'has' : 'have'} no field to go in and {plan.extraCols === 1 ? 'isn\'t' : 'aren\'t'} pasted.</p>}
        <p className="paste-hint">Blank cells leave their fields as they are. Nothing is sent until you press Enter.</p>
        <div className="dialog-actions">
          <button type="submit" className="primary" autoFocus disabled={count === 0}>Paste {plural(count, 'value')}</button>
          <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
