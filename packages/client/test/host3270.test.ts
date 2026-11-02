// The browser on a 3270 host: its keys, numeric fields, legends, screen sizes
// and screens without fields, and the designer's choices for it.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { getCodepage, type ScreenSnapshot } from '@veneer/terminal';
import { Attr, Color, HostStream, Terminal, snapshot } from '@veneer/tn3270';
import { screenId } from '@veneer/screens';
import { describeChange } from '../src/designer/changes.ts';
import { moveTabEdge } from '../src/designer/edit.ts';
import { transform } from '../src/transform/index.ts';
import { lineModeInput } from '../src/transform/lineMode.ts';
import { exportColumns, pageRows } from '../src/export/sheet.ts';
import type { FieldItem, TableItem } from '../src/transform/types.ts';
import { acceptsChar, cellInputWidth, checkFields, isShortField, erasedInput, erasedToEnd, filterValue, isNumeric, overtyped, takesNumbers } from '../src/ui/fieldRules.ts';
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

// ---- Boxes of asterisks

/**
 * What TSO showed after leaving its applications menu (from TK4-): a message
 * in a box of '*', all of it written as unprotected fields as TSO's line mode
 * does, then READY and the input area, with the cursor on the next line.
 */
const tsoReady = (cursorRow = 6, cursorCol = 1) => screen((s) => {
  const lines = [
    '******************************************************',
    '*** TSO Applications Menu terminated.              ***',
    '*** Enter TSOAPPLS at the READY prompt to restart. ***',
    '******************************************************',
  ];
  lines.forEach((l, i) => s.input(i + 1, 9, l.length, { value: l, attr: 0x08 }));
  return s.input(5, 2, 6, { value: 'READY', attr: 0x08 }).input(5, 9, 1591 - 80).cursor(cursorRow, cursorCol);
});

test('a TSO message in a box of asterisks is not a pop-up window when the cursor is below it', () => {
  const view = transform(tsoReady());
  assert.equal(view.window, undefined);
  const inputs = view.items.filter((i): i is FieldItem => i.kind === 'field').map((i) => i.field.id);
  assert.ok(inputs.includes('5:9'), 'the READY input is there to type into');
  assert.match(JSON.stringify(view.items), /TSO Applications Menu terminated/, 'and the message still shows');
});

test('on a 3270 a box with the cursor in it is still a pop-up window', () => {
  const view = transform(tsoReady(3, 20));
  assert.equal(view.window?.title, 'TSO Applications Menu terminated.');
});

// ---- TSO line mode, from screens recorded on TK4-

const tk4 = JSON.parse(fs.readFileSync(new URL('../../tn3270/test/fixtures/tk4.json', import.meta.url), 'utf8')) as Record<string, { model: number; records: string[] }>;
function recorded(name: string): ScreenSnapshot {
  const f = tk4[name]!;
  const t = new Terminal({ codepage: cp, model: f.model, send3270: () => {}, sendSscpLu: () => {}, onWarning: (w) => { throw new Error(w); } });
  for (const hex of f.records) t.processRecord(Buffer.from(hex, 'hex'));
  return snapshot(t.screen, cp);
}
const tableOf = (v: ReturnType<typeof transform>) => {
  const t = v.items.find((i): i is TableItem => i.kind === 'table');
  assert.ok(t, 'a table');
  return t;
};
const inputIds = (v: ReturnType<typeof transform>) => v.items.filter((i): i is FieldItem => i.kind === 'field').map((i) => i.field.id);

test('TSO line mode shows its output as text and keeps only the input at the cursor', () => {
  for (const [name, input, label] of [['tsoReady', '5:9', 'READY'], ['tsoListcat', '24:6', '***'], ['tsoPassword', '2:2', undefined]] as const) {
    const snap = recorded(name);
    assert.equal(lineModeInput(snap)?.id, input, name);
    const view = transform(snap);
    assert.equal(view.lineMode, true, name);
    assert.deepEqual(inputIds(view), [input], `${name}: one input`);
    const field = view.items.find((i): i is FieldItem => i.kind === 'field')!;
    if (label) assert.equal(field.label, label, `${name}: labelled by its prompt`);
    assert.equal(view.window, undefined, `${name}: a box of asterisks is not a window`);
    assert.ok(view.items.every((i) => i.kind !== 'text' || i.role === 'normal'), `${name}: not shown as errors`);
  }
  const listcat = transform(recorded('tsoListcat'));
  assert.ok(listcat.items.some((i) => i.kind === 'text' && i.text.includes('NONVSAM ------- SYS1.ACMDLIB')));
  assert.equal(recorded('tsoPassword').fields.find((f) => f.id === '2:2')?.attr.nonDisplay, true, 'the password stays hidden');
});

test('full-screen programs are never taken for line mode', () => {
  for (const name of ['vtamLogon', 'tsoMenu', 'tsoMenuModel5', 'rfeDslist', 'termtest']) {
    const snap = recorded(name);
    assert.equal(lineModeInput(snap), undefined, name);
    assert.equal(transform(snap).lineMode, undefined, name);
  }
  const rfe = transform(recorded('rfeDslist'));
  assert.deepEqual(inputIds(rfe), ['2:15', '2:78'], 'RFE keeps its command and scroll inputs');
  assert.equal(tableOf(rfe).rows[0]!.cells[0]!.field?.id, '4:2', 'and its selection fields, in the list');
});

test('line mode needs no protected fields, and the cursor in the last field', () => {
  // An editor's last line: an input running to the end of the screen with the cursor in
  // it, but the screen has protected fields (labels, line numbers), so it is a form.
  const editor = screen((s) => s.text(1, 2, 'EDIT ---- HERC01.TEST.DATA').text(24, 1, '000100').at(24, 8).field({ attr: Attr.INPUT }).cursor(24, 9));
  assert.equal(editor.fields.at(-1)?.bypass, false);
  assert.equal(lineModeInput(editor), undefined);
  assert.equal(transform(editor).lineMode, undefined);
  // The real READY screen with the cursor moved off the input.
  const snap = recorded('tsoReady');
  assert.equal(lineModeInput({ ...snap, cursor: { row: 1, col: 10 } }), undefined);
});

test('line mode is only for 3270 screens, and not for a screen with one field', () => {
  const snap = recorded('tsoReady');
  assert.equal(lineModeInput({ ...snap, host: '5250' }), undefined);
  assert.equal(lineModeInput(screen((s) => s.at(1, 2).chars('READY').cursor(2, 1))), undefined, 'unformatted: just the typing field');
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

test('a header row of label/value pairs has no page title; real titles are kept', () => {
  for (const name of ['vtamLogon', 'tsoMenu', 'tsoMenuModel5']) {
    const view = transform(recorded(name));
    assert.equal(view.title, undefined, name);
    assert.deepEqual(view.meta.map((m) => m.text), ['Terminal CUU0C0', 'Date 02.11.26'], name);
  }
  assert.equal(transform(recorded('rfeDslist')).title, 'RFE DSLIST');
  assert.equal(transform(recorded('termtest')).title, 'TSO 3270 VDU TEST');
});

test('a title beside other header text is still the title, and a dash run never is', () => {
  const titled = screen((s) => s.text(1, 33, 'Customer Inquiry').text(1, 51, 'PROD'));
  assert.equal(transform(titled).title, 'Customer Inquiry', 'too long to be a label, so not one of a pair');
  const dashes = screen((s) => s.text(1, 2, 'MYAPP').text(1, 30, '--------------------'));
  assert.equal(transform(dashes).title, undefined);
});

// ---- Lists in ISPF-style tools (RFE's data set list on TK4-)

test('an ISPF-style list is a table: headings in one colour, rows with the same selection field', () => {
  const view = transform(recorded('rfeDslist'));
  const table = tableOf(view);
  assert.deepEqual([table.row, table.col, table.height], [3, 2, 22]);
  assert.deepEqual(table.columns.map((c) => c.header), ['S', 'DATA-SET-NAME', 'VOLUME', 'ALTRK', 'USTRK', 'ORG', 'FRMT', '%', 'XT', 'LRECL', 'BLKSZ']);
  assert.equal(table.rows.length, 21);
  assert.deepEqual(table.rows[0]!.cells.map((c) => c.field ? `[${c.field.id}]` : c.text),
    ['[4:2]', 'SYS1.ACMDLIB', 'MVSDLB', '71', '47', 'PO', 'U', '66', '1', '', '6144']);
  assert.deepEqual(table.columns[0], { col: 2, width: 2, header: 'S' }, 'the one-character selection field has its own column');
  assert.equal(table.more, true, 'Row 1 of 129');
});

test('every page of an ISPF-style list has the same columns, so it exports', () => {
  const pages = ['rfeDslist', 'rfeDslistPage2'].map((n) => tableOf(transform(recorded(n))));
  assert.deepEqual(pages[1]!.columns, pages[0]!.columns, 'page 2 has no LRECL values, and still has the column');
  assert.deepEqual(exportColumns(pages[1]!), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'the selection column is left out');
  assert.deepEqual(pageRows(pages[1]!, exportColumns(pages[1]!))[0], ['SYS1.AOSD8', 'MVSDLB', '32', '22', 'PO', 'U', '68', '1', '', '6144']);
  assert.equal(screenId(recorded('rfeDslistPage2')), screenId(recorded('rfeDslist')), 'one screen id for every page');
});

const list3270 = (heading: string, rows: string[], opts: { rowOf?: string; headingAttr?: number } = {}) => screen((s) => {
  s.text(1, 30, 'MY LIST');
  if (opts.rowOf) s.text(1, 60, opts.rowOf);
  s.text(3, 2, heading, { attr: opts.headingAttr ?? Attr.BRIGHT });
  rows.forEach((r, i) => s.input(4 + i, 2, 1).text(4 + i, 4, r));
  return s;
});

test('a heading that values run across stays one column ("DATA SET NAME"); "Row x of y" decides more', () => {
  const rows = ['SYS1.LINKLIB      MVSRES', 'HERC01.CNTL       PUB001', 'SYS2.PROCLIB      MVS000'];
  const heading = 'S DATA SET NAME     VOLUME';
  const table = tableOf(transform(list3270(heading, rows, { rowOf: 'Row 1 of 3' })));
  assert.deepEqual(table.columns.map((c) => [c.col, c.header]), [[2, 'S'], [4, 'DATA SET NAME'], [22, 'VOLUME']]);
  assert.equal(table.more, false, 'rows 1 to 3 of 3');
  assert.equal(tableOf(transform(list3270(heading, rows))).more, true, 'without "Row x of y", paging finds the end');
});

test('not an ISPF-style list: too few rows, rows with different fields, or headings in the rows\' colour', () => {
  const noTable = (snap: ScreenSnapshot) => assert.equal(transform(snap).items.some((i) => i.kind === 'table'), false);
  noTable(list3270('NAME VOLUME SIZE', ['A  V1  1', 'B  V2  2']));
  noTable(screen((s) => s.text(3, 2, 'NAME VOLUME SIZE', { attr: Attr.BRIGHT })
    .input(4, 2, 1).text(4, 4, 'A').input(5, 2, 2).text(5, 5, 'B').input(6, 2, 1).text(6, 4, 'C')));
  noTable(list3270('NAME VOLUME SIZE', ['A  V1  1', 'B  V2  2', 'C  V3  3'], { headingAttr: Attr.TEXT }));
  noTable(list3270('NAME        VOLUME', ['A  V1', 'B  V2', 'C  V3']));
  noTable(screen((s) => {
    s.text(3, 2, 'NAME', { attr: Attr.BRIGHT }).text(3, 8, 'VOLUME', { attr: Attr.BRIGHT, color: Color.YELLOW }).text(3, 16, 'SIZE', { attr: Attr.BRIGHT });
    ['A', 'B', 'C'].forEach((r, i) => s.input(4 + i, 2, 1).text(4 + i, 4, r));
    return s;
  }));
});

test('ISPF title rows lose their dashes in the page header', () => {
  assert.deepEqual(transform(recorded('rfeDslist')).meta.map((m) => [m.col, m.text]), [[69, 'Row 1 of 129']]);
});

test('short fields fit their characters and the attribute byte after them, so they never cover the next column', () => {
  assert.deepEqual([1, 2, 3, 4].map((length) => isShortField({ length })), [true, true, true, false]);
  assert.equal(cellInputWidth({ length: 1 }), 'calc(2 * var(--cw))', 'RFE\'s selection field: 2 columns');
  assert.equal(cellInputWidth({ length: 3 }), 'calc(4 * var(--cw))');
  assert.equal(cellInputWidth({ length: 10 }), 'calc(10 * var(--cw) + 1.2em)', 'longer fields keep their padding');
  const rfe = tableOf(transform(recorded('rfeDslist')));
  assert.equal(rfe.columns[0]!.width, 2, 'and the selection column is that wide');
});
