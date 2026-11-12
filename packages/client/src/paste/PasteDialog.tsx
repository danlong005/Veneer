// The preview of a paste (paste.ts): what goes in which field, and what
// stopped it, before anything is typed. Nothing is sent to the host; the
// values become edits, as if typed, and Enter is still the user's to press.

import { useState } from 'react';
import type { PastePlan } from './paste.ts';
import { problemText } from './paste.ts';

const PREVIEW_ROWS = 50;

export function PasteDialog({ plan, total, next, onPaste, onCancel }: {
  plan: PastePlan;
  /** Rows pasted in all. */
  total: number;
  /** The key that adds a page's lines, when the screen lets a paste go on to the next pages ("Enter"). */
  next?: string | undefined;
  /** `more`: go on to the next pages. */
  onPaste: (more: boolean) => void;
  onCancel: () => void;
}) {
  const count = Object.keys(plan.edits).length;
  const canGoOn = Boolean(next) && plan.kind !== 'fields' && plan.extraRows > 0 && !plan.problem;
  const [more, setMore] = useState(canGoOn);
  const goingOn = canGoOn && more;
  const problem = problemText(plan);
  const shown = plan.rows.slice(0, PREVIEW_ROWS);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="paste-title" onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
      <form className="dialog paste-dialog" onSubmit={(e) => { e.preventDefault(); onPaste(goingOn); }}>
        <h2 id="paste-title">Paste {plan.kind === 'fields' ? `into ${plural(plan.columns.length, 'field')}` : goingOn ? `${plural(total, 'row')}, ${plan.rows.length} on this page` : plural(plan.rows.length, 'row')}</h2>
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
        {canGoOn && (
          <label className="paste-more">
            <input type="checkbox" checked={more} onChange={(e) => setMore(e.target.checked)} />
            <span>Press {next} after this page and paste the other {plural(plan.extraRows, 'row')} on the next pages. The last page is filled for you to check and send.</span>
          </label>
        )}
        {plan.extraRows > 0 && !goingOn && <p className="paste-hint">This screen has room for {plural(plan.rows.length, 'row')} from here; the other {plural(plan.extraRows, 'row')} aren't pasted. Press Enter or Page Down, then paste them on the next page.</p>}
        {plan.extraCols > 0 && <p className="paste-hint">{plural(plan.extraCols, 'column')} at the right {plan.extraCols === 1 ? 'has' : 'have'} no field to go in and {plan.extraCols === 1 ? 'isn\'t' : 'aren\'t'} pasted.</p>}
        <p className="paste-hint">Blank cells leave their fields as they are.{goingOn ? ' Esc stops between pages.' : ' Nothing is sent until you press Enter.'}</p>
        <div className="dialog-actions">
          <button type="submit" className="primary" autoFocus disabled={count === 0}>{goingOn ? `Paste ${plural(total, 'row')}` : `Paste ${plural(count, 'value')}`}</button>
          <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
