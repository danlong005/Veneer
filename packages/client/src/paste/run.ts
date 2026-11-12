// Pasting more rows than a page holds (#43), on screens whose definition
// allows it (`paste.next`): fill the page, press the key that adds its lines
// (Enter or Page Down), and on the page that follows, paste the rest from its
// first line. The last page is filled but not sent: Enter stays the user's.
//
// It stops, keeping what was filled, on a host error, another screen, a page
// the host gave back without taking it (its first line still filled), a value
// a field won't take, or Cancel.

import type { FieldSnapshot } from '@veneer/terminal';
import type { ScreenView } from '@veneer/view';
import { firstLine, planRows, problemText, type PastePlan } from './paste.ts';

export interface PasteProgress {
  /** Rows filled, of `total`. */
  rows: number;
  total: number;
  /** Pages sent so far. */
  pages: number;
}

export type PasteStep =
  /** Fill these fields and press the key. */
  | { send: { fields: Record<string, string> } }
  /**
   * Finished: `edits` are the last page's values, for the user to check and
   * send; `error` says why it stopped early (null when every row is in).
   */
  | { done: true; edits: Record<string, string>; error: string | null };

export class PasteRun {
  private readonly data: string[][];
  private readonly screen: string;
  /** The field the first page started in: each next page starts in its column. */
  private readonly start: FieldSnapshot;
  private readonly keyName: string;
  private done = 0;
  private pages = 0;
  private cancelled = false;
  /** The ids of the fields on the first line just sent, to tell a page taken from one given back. */
  private sentFirst: string[] = [];
  private readonly first: PastePlan;

  /**
   * `first` is the plan already shown in the preview, for `data` (every row
   * pasted), on the screen `screen`; `keyName` says which key in messages.
   */
  constructor(first: PastePlan, data: string[][], screen: string, start: FieldSnapshot, keyName: string) {
    this.data = data;
    this.screen = screen;
    this.start = start;
    this.keyName = keyName;
    this.first = first;
  }

  get progress(): PasteProgress {
    return { rows: this.done, total: this.data.length, pages: this.pages };
  }

  cancel(): void {
    this.cancelled = true;
  }

  begin(): PasteStep {
    return this.page(this.first);
  }

  /** The screen after the key. `error` is the host's error, if it showed one. */
  onScreen(view: ScreenView, screen: string, fields: readonly FieldSnapshot[], error: string | null): PasteStep {
    const left = this.data.length - this.done;
    const stop = (why: string): PasteStep => ({ done: true, edits: {}, error: `${why} ${left} ${left === 1 ? 'row was' : 'rows were'} not pasted.` });
    if (this.cancelled) return stop('Cancelled.');
    if (error) return stop(`The host refused the page: ${error.trim()}`);
    if (screen !== this.screen) return stop(`After ${this.keyName}, the host showed another screen.`);
    // A page given back with its lines still filled wasn't taken (the program found a problem).
    const kept = this.sentFirst.some((id) => (fields.find((f) => f.id === id)?.value.trim() ?? '') !== '');
    if (kept) {
      const message = view.window?.message?.text ?? view.message?.text;
      return stop(`The host didn't take the page${message?.trim() ? `: ${message.trim()}` : ''}.`);
    }
    const at = firstLine(view, this.start);
    if (!at) return stop('The next page has no line to paste into.');
    const plan = planRows(view, at, this.data.slice(this.done));
    if ('error' in plan) return stop(plan.error);
    return this.page(plan);
  }

  /** Fill a page: the last one (or one with a problem) for the user; a full one sent with the key. */
  private page(plan: PastePlan): PasteStep {
    const before = this.done;
    if (plan.problem || plan.extraRows === 0) {
      this.done += plan.problem ? plan.problem.row - 1 : plan.rows.length;
      // The row as the user counts it: in everything pasted, not on this page.
      const problem = problemText(plan)?.replace(/^Row \d+/, `Row ${before + (plan.problem?.row ?? 0)}`);
      return { done: true, edits: plan.edits, error: problem ? `${problem} The rows from there on were not pasted.` : null };
    }
    this.done += plan.rows.length;
    this.pages++;
    this.sentFirst = plan.columns.flatMap((t) => (t ? [t.field.id] : []));
    return { send: { fields: plan.edits } };
  }
}
