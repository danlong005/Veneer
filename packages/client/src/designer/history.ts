// Undo and redo for the designer's draft. Edits close together in time (typing
// a name, tapping arrow keys) make one step, so undo goes back a step a person
// would recognise rather than one keystroke.

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** When the present was last edited (ms), or 0 when the next edit starts a new step. */
  editedAt: number;
}

/** Edits this close to the previous one join its step. */
export const MERGE_MS = 1000;
/** Steps kept; older ones are dropped. */
export const LIMIT = 100;

export function startHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], editedAt: 0 };
}

export function record<T>(h: History<T>, next: T, now: number): History<T> {
  if (JSON.stringify(next) === JSON.stringify(h.present)) return h;
  const merge = h.editedAt > 0 && now - h.editedAt < MERGE_MS;
  return {
    past: merge ? h.past : [...h.past, h.present].slice(-LIMIT),
    present: next,
    future: [],
    editedAt: now,
  };
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future], editedAt: 0 };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1), editedAt: 0 };
}
