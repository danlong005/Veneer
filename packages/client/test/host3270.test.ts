// The browser on a 3270 host: its keys, numeric fields, legends, screen sizes
// and screens without fields, and the designer's choices for it.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getCodepage, type ScreenSnapshot } from '@veneer/terminal';
import { Attr, HostStream, Terminal, snapshot } from '@veneer/tn3270';
import { describeChange } from '../src/designer/changes.ts';
import { moveTabEdge } from '../src/designer/edit.ts';
import { transform } from '../src/transform/index.ts';
import type { FieldItem } from '../src/transform/types.ts';
import { acceptsChar, checkFields, erasedInput, erasedToEnd, filterValue, isNumeric, overtyped, takesNumbers } from '../src/ui/fieldRules.ts';
import { KEYS_3270, buttonAids, keyAction, keyHint, typedKey, type KeyContext } from '../src/ui/keys.ts';
import { layoutOf } from '../src/ui/layout.ts';
import { stepValue } from '../src/ui/spinner.ts';

const cp = getCodepage(37);
const SIZES: Record<number, { rows: number; cols: number }> = { 2: { rows: 24, cols: 80 }, 3: { rows: 32, cols: 80 }, 4: { rows: 43, cols: 80 }, 5: { rows: 27, cols: 132 } };

/** A 3270 screen, run through the real 3270 terminal. Models 3-5 draw it at their alternate size. */
function screen(build: (s: HostStream) => HostStream, model = 2): ScreenSnapshot {
  const t = new Terminal({ codepage: cp, model, send3270: () => {}, sendSscpLu: () => {}, onWarning: (w) => { throw new Error(w); } });
  const s = new HostStream().eraseWrite(model === 2 ? {} : { alternate: SIZES[model]! });
  t.processRecord(Uint8Array.from(build(s).build()));
  return snapshot(t.screen, cp);
}

const MAINFRAME: KeyContext = { host: '3270', paging: true };
const NO_PAGING: KeyContext = { host: '3270', paging: false };
const IBM_I: KeyContext = { host: '5250', paging: true };
const press = (key: string, opts: { shift?: boolean; target?: { tagName: string; dataset?: Record<string, string> } } = {}) =>
  ({ key, shiftKey: opts.shift ?? false, altKey: false, ctrlKey: false, metaKey: false, target: opts.target ?? { tagName: 'BODY' } }) as unknown as KeyboardEvent;
const IN_FIELD = { tagName: 'INPUT', dataset: { field: '5:20' } };

// ---- Keys

test('3270 keys: PF keys as on a 5250, Pause is Clear, End is Erase EOF in a field, Insert switches typing over', () => {
  assert.equal(keyAction(press('F3'), MAINFRAME), 'F3');
  assert.equal(keyAction(press('F12', { shift: true }), MAINFRAME), 'F24');
  assert.equal(keyAction(press('Pause'), MAINFRAME), 'Clear');
  assert.equal(keyAction(press('End', { target: IN_FIELD }), MAINFRAME), 'EraseEOF');
  assert.equal(keyAction(press('End', { target: { tagName: 'BUTTON' } }), MAINFRAME), null, 'outside a field End is End');
  assert.equal(keyAction(press('Insert'), MAINFRAME), 'Insert');
  assert.equal(keyAction(press('Escape'), MAINFRAME), 'Reset');
  // None of the 3270 editing keys on a 5250.
  for (const key of ['Pause', 'Insert']) assert.equal(keyAction(press(key), IBM_I), null, key);
  assert.equal(keyAction(press('End', { target: IN_FIELD }), IBM_I), null);
});

test('Page Up and Page Down go to the server (which sends PF7/PF8) unless paging is off', () => {
  assert.equal(keyAction(press('PageDown'), MAINFRAME), 'PageDown');
  assert.equal(keyAction(press('PageUp'), MAINFRAME), 'PageUp');
  assert.equal(keyAction(press('PageDown'), NO_PAGING), null);
  assert.equal(keyAction(press('PageDown'), IBM_I), 'PageDown');
});

test('typing ahead keeps host keys but not the local editing keys', () => {
  assert.deepEqual(typedKey(press('F8'), MAINFRAME), { kind: 'aid', aid: 'F8' });
  assert.deepEqual(typedKey(press('Pause'), MAINFRAME), { kind: 'aid', aid: 'Clear' });
  assert.equal(typedKey(press('Insert'), MAINFRAME), null);
  assert.equal(typedKey(press('End', { target: IN_FIELD }), MAINFRAME), null);
  assert.deepEqual(typedKey(press('x'), MAINFRAME), { kind: 'char', ch: 'x' });
});

test('keys are labelled by their 3270 names, and the Keys menu and designer offer the 3270 ones', () => {
  assert.equal(keyHint('F3', '3270'), 'PF3');
  assert.equal(keyHint('F24', '3270'), 'PF24');
  assert.equal(keyHint('PA2', '3270'), 'PA2');
  assert.equal(keyHint('F3', '5250'), 'F3');
  assert.equal(keyHint('PageDown'), 'PgDn');
  assert.equal(KEYS_3270.length, 28);
  assert.deepEqual(KEYS_3270.slice(-4), ['PA1', 'PA2', 'PA3', 'Clear']);
  const mainframe = buttonAids('3270');
  for (const k of ['PA1', 'PA3', 'Clear', 'F24'] as const) assert.ok(mainframe.includes(k), k);
  for (const k of ['PageUp', 'PageDown', 'Help', 'Print'] as const) assert.ok(!mainframe.includes(k), k);
  const ibmi = buttonAids('5250');
  assert.ok(ibmi.includes('Help') && ibmi.includes('PageDown') && !ibmi.includes('PA1'));
});

// ---- Legends

test('a 3270 legend ("PF3=Return  PA2=Redisplay  Clear=Blank screen") becomes key buttons', () => {
  const snap = screen((s) => s
    .text(1, 35, 'Order List', { attr: Attr.BRIGHT })
    .text(5, 2, 'Some orders here')
    .text(24, 2, 'PF3=Return  PF7=Back  PF8=Forward  PA2=Redisplay  Clear=Blank screen'));
  const view = transform(snap);
  assert.deepEqual(view.functionKeys.map((k) => [k.aid, k.label]), [
    ['F3', 'Return'], ['F7', 'Back'], ['F8', 'Forward'], ['PA2', 'Redisplay'], ['Clear', 'Blank screen'],
  ]);
  assert.doesNotMatch(JSON.stringify(view.items), /PF3=Return/, 'not drawn as text too');
});

// ---- Fields

const numericScreen = () => screen((s) => s
  .text(3, 2, 'Amount').input(3, 20, 9, { attr: Attr.NUMERIC })
  .text(4, 2, 'Name').input(4, 20, 10)
  .text(5, 2, 'Code').input(5, 20, 4, { mandatoryEntry: true, mandatoryFill: true }));

test('3270 numeric fields take digits, a decimal point and a minus sign, as the numeric lock does', () => {
  const amount = numericScreen().fields.find((f) => f.id === '3:20')!;
  assert.equal(amount.numeric, true);
  for (const ch of ['0', '9', '.', '-']) assert.ok(acceptsChar(amount, ch), ch);
  for (const ch of ['a', ' ', '+', ',', '$']) assert.ok(!acceptsChar(amount, ch), ch);
  assert.equal(filterValue(amount, '12a.5-x'), '12.5-');
  assert.equal(isNumeric(amount), false, 'not right-aligned and no Field+/Field-: those are 5250');
  assert.equal(takesNumbers(amount), true, 'so the designer offers a spinner');
  const name = numericScreen().fields.find((f) => f.id === '4:20')!;
  assert.ok(acceptsChar(name, 'a') && !takesNumbers(name));
});

test('typing over replaces the character at the caret, within the field\'s rules and length', () => {
  const [amount, name] = numericScreen().fields.filter((f) => !f.bypass);
  assert.equal(overtyped(name!, 'Harbor', 0, 'X'), 'Xarbor');
  assert.equal(overtyped(name!, 'Harbor', 5, 's'), 'Harbos');
  assert.equal(overtyped(name!, 'Harbor', 6, 's'), 'Harbors', 'past the end it adds');
  assert.equal(overtyped(name!, 'ABCDEFGHIJ', 9, 'Z'), 'ABCDEFGHIZ', 'never longer than the field');
  assert.equal(overtyped(amount!, '125', 1, '9'), '195');
  assert.equal(overtyped(amount!, '125', 1, 'x'), null, 'the numeric lock still applies');
});

test('Erase EOF blanks from the caret; Erase Input blanks every input field', () => {
  assert.equal(erasedToEnd('202-555-0117', 3), '202');
  assert.equal(erasedToEnd('202', 0), '');
  const snap = numericScreen();
  assert.deepEqual(erasedInput(snap.fields), { '3:20': '', '4:20': '', '5:20': '' });
});

test('mandatory entry and mandatory fill from 3270 field validation are checked before Enter', () => {
  const fields = numericScreen().fields;
  assert.match(checkFields(fields, {})!.message, /requires an entry/);
  assert.match(checkFields(fields, { '5:20': 'AB' })!.message, /completely filled \(4 characters\)/);
  assert.equal(checkFields(fields, { '5:20': 'ABCD' }), null);
});

test('a spinner on a 3270 numeric field keeps the decimals typed', () => {
  const amount = numericScreen().fields.find((f) => f.id === '3:20')!;
  assert.equal(stepValue('12.50', amount, { step: 1 }, true), '13.50');
  assert.equal(stepValue('', amount, { step: 5 }, true), '5');
  assert.equal(stepValue('0', amount, { min: 0, step: 1 }, false), null, 'already at the lowest');
});

// ---- Screen sizes

test('each model\'s size lays out to its last row and column', () => {
  for (const [model, { rows, cols }] of Object.entries(SIZES).map(([m, s]) => [Number(m), s] as const)) {
    const snap = screen((s) => s
      .text(1, 2, `Model ${model}`)
      .text(rows, cols - 11, 'Bottom right')
      .text(rows - 1, 2, 'Input').input(rows - 1, 10, 5)
      .cursor(rows - 1, 10), model);
    assert.deepEqual([snap.rows, snap.cols], [rows, cols], `model ${model}`);
    const view = transform(snap);
    assert.deepEqual([view.rows, view.cols], [rows, cols]);
    const layout = layoutOf(view);
    assert.equal(layout.bottom, rows, `model ${model}: down to the last row`);
    const field = view.items.find((i): i is FieldItem => i.kind === 'field');
    assert.deepEqual([field?.field.row, field?.field.col], [rows - 1, 10]);
    assert.ok(JSON.stringify(view.items).includes('Bottom right'));
  }
});

// ---- Screens without fields

test('a screen without fields offers one input at the cursor, for typing a command', () => {
  const snap = screen((s) => s.at(1, 2).chars('Type the name of an application and press Enter:').cursor(3, 2));
  const view = transform(snap);
  const inputs = view.items.filter((i): i is FieldItem => i.kind === 'field');
  assert.deepEqual(inputs.map((i) => i.field.id), ['3:2']);
  assert.equal(inputs[0]!.field.bypass, false);
  assert.ok(JSON.stringify(view).includes('Type the name of an application'), 'the text still shows');
});

// ---- The designer

test('the designer names 3270 keys by their 3270 names, and tabs can run to row 43', () => {
  const snap = screen((s) => s.text(1, 2, 'Menu'), 4);
  const view = transform(snap);
  assert.equal(describeChange({ op: 'button', label: 'Back', action: { aid: 'F3' } }, view, snap).label, 'Button “Back”: presses PF3');
  assert.equal(describeChange({ op: 'button', label: 'Undo', action: { aid: 'PA2' } }, view, snap).label, 'Button “Undo”: presses PA2');
  const tabs = [{ title: 'One', from: 3, to: 10 }, { title: 'Two', from: 11, to: 20 }];
  assert.equal(moveTabEdge(tabs, 2, 43, 43)[1]!.to, 43);
  assert.equal(moveTabEdge(tabs, 2, 50, 43)[1]!.to, 43, 'not past the screen');
});
