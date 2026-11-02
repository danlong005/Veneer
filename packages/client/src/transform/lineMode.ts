// TSO line mode on a 3270: READY, command output and *** pauses. TSO writes
// every line of output as an unprotected field, so as fields they would all
// be input boxes. What marks line mode (from TK4-'s traces): no protected
// fields at all, and the cursor in the last field, which runs on to the end of
// the screen (as the last field always does when nothing is protected: fields
// wrap round to the first attribute). Full-screen programs (menus, editors,
// ISPF-like panels) always have protected fields, so they are never taken for
// line mode.

import type { FieldSnapshot, ScreenSnapshot } from '@veneer/terminal';

/** The field the user types into, if this is a line-mode screen. */
export function lineModeInput(snap: ScreenSnapshot): FieldSnapshot | undefined {
  if (snap.host !== '3270' || snap.fields.some((f) => f.bypass)) return undefined;
  const inputs = snap.fields;
  // One field alone is a screen without fields (or after Clear): typing at the cursor, nothing else.
  if (inputs.length < 2) return undefined;
  const last = inputs[inputs.length - 1]!;
  const start = (last.row - 1) * snap.cols + (last.col - 1);
  const cursor = (snap.cursor.row - 1) * snap.cols + (snap.cursor.col - 1);
  return cursor >= start && cursor < start + last.length ? last : undefined;
}

/** The screen with its output lines made text: only the input stays a field. */
export function asLineMode(snap: ScreenSnapshot, input: FieldSnapshot): ScreenSnapshot {
  return { ...snap, fields: snap.fields.map((f) => (f === input ? f : { ...f, bypass: true })) };
}
