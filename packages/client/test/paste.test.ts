// Pasting rows from a spreadsheet (#43): the clipboard's tab-separated text,
// where each cell goes (a list's rows, entry fields repeated down the screen,
// or the fields that follow on an entry screen), and each value through the
// field's rules and widget.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Widget } from '@veneer/screens';
import type { FieldSnapshot } from '@veneer/terminal';
import { Attr } from '@veneer/tn5250';
import { customize, transform } from '@veneer/view';
import { fieldValue, isRows, parseRows, pasteGrid, planPaste, problemText, type PastePlan } from '../src/paste/paste.ts';
import { orderEntry, render, workWithJobs } from './screens.ts';

const { WHITE, BLUE } = Attr;

/** An order's lines: a list of entry fields (item, monocase; quantity, signed; ship date, numeric) under headings. */
const orderLines = () => render((s) => {
  s.text(1, 33, 'Order Lines', WHITE).text(3, 2, 'Customer').field(3, 12, 6)
    .text(5, 2, 'Line  Item      Qty    Ship date', WHITE);
  for (let r = 6; r <= 10; r++) s.text(r, 2, String(r - 5).padStart(3)).field(r, 8, 6, { ffw: 0x4020 }).field(r, 18, 5, { ffw: 0x4700 }).field(r, 25, 8, { ffw: 0x4300 });
  return s.text(19, 73, 'More...').text(22, 2, 'F3=Exit   F12=Cancel', BLUE);
});

/** Entry fields repeated down the screen with no headings, so not a list: three lines of item and quantity. */
const repeated = () => render((s) => s
  .text(1, 33, 'Quick Order', WHITE)
  .text(4, 3, 'Items').field(4, 20, 6).field(4, 30, 3, { ffw: 0x4300 })
  .field(5, 20, 6).field(5, 30, 3, { ffw: 0x4300 })
  .field(6, 20, 6).field(6, 30, 3, { ffw: 0x4300 })
  .text(8, 3, 'Notes').field(8, 20, 30));

const plan = (snap: ReturnType<typeof orderLines>, at: string, text: string, def?: Parameters<typeof customize>[1]): PastePlan => {
  const view = def ? customize(transform(snap), def) : transform(snap);
  const p = planPaste(view, at, text);
  assert.ok(!('error' in p), 'error' in p ? p.error : '');
  return p;
};

test('the clipboard as a spreadsheet copies it: rows, tabs, and quoted cells', () => {
  assert.deepEqual(parseRows('A1\tB1\r\nA2\tB2\r\n'), [['A1', 'B1'], ['A2', 'B2']], 'the last line break is not another row');
  assert.deepEqual(parseRows('a\t\tc\n\tb\n'), [['a', '', 'c'], ['', 'b']], 'blank cells keep their place');
  assert.deepEqual(parseRows('"two\nlines"\t"say ""hi"""\nx'), [['two\nlines', 'say "hi"'], ['x']]);
  assert.deepEqual(parseRows('5" pipe\tx'), [['5" pipe', 'x']], 'a quote inside a cell is just a quote');
  assert.equal(isRows('one value'), false);
  assert.equal(isRows('one value\n'), false, 'one cell copied with its line break');
  assert.equal(isRows('a\tb'), true);
  assert.equal(isRows('a\nb'), true);
});

test('in a list, cells go to the input columns from the one pasted into, row by row', () => {
  const p = plan(orderLines(), '6:8', 'ab12\t5\t20261201\nCD34\t-3\t\n');
  assert.equal(p.kind, 'list');
  assert.deepEqual(p.columns.map((t) => t?.name), ['Item', 'Qty', 'Ship date']);
  assert.deepEqual(p.edits, { '6:8': 'AB12', '6:18': '5', '6:25': '20261201', '7:8': 'CD34', '7:18': '3-' }, 'monocase, the sign as Field- puts it, and a blank cell left alone');
  assert.deepEqual(p.rows, [['AB12', '5', '20261201'], ['CD34', '3-', null]]);
  assert.equal(p.problem, undefined);

  // From the second column, one row down: the paste starts there.
  assert.deepEqual(plan(orderLines(), '7:18', '1\t20260101').edits, { '7:18': '1', '7:25': '20260101' });

  // More rows than the page has, and more columns than fields.
  const big = plan(orderLines(), '9:8', 'A\t1\t1\tx\nB\t2\t2\nC\t3\t3\n');
  assert.deepEqual(Object.keys(big.edits), ['9:8', '9:18', '9:25', '10:8', '10:18', '10:25']);
  assert.equal(big.extraRows, 1);
  assert.equal(big.extraCols, 1);

  // The jobs list's option column.
  assert.deepEqual(plan(workWithJobs(), '11:3', '5\n\n4').edits, { '11:3': '5', '13:3': '4' });
});

test('a value a field won\'t take stops the paste at that cell, saying which row and column', () => {
  const p = plan(orderLines(), '6:8', 'A1\t2\t20260101\nB2\t1.5\t20260101\nC3\t1\t20260101');
  assert.deepEqual(p.edits, { '6:8': 'A1', '6:18': '2', '6:25': '20260101', '7:8': 'B2' }, 'the cells before it');
  assert.deepEqual(p.problem, { row: 2, col: 2, name: 'Qty', cell: '1.5', message: '“1.5” has characters the field doesn\'t take (digits, and a sign only; the decimal point is implied, as in 1250 for 12.50).' });
  assert.equal(p.rows.length, 2, 'the preview ends at the problem');
  assert.equal(problemText(p), 'Row 2, column 2 (Qty): “1.5” has characters the field doesn\'t take (digits, and a sign only; the decimal point is implied, as in 1250 for 12.50).');

  const long = plan(orderLines(), '6:8', 'TOOLONG1\t1');
  assert.equal(long.problem?.message, '“TOOLONG1” is longer than the field (6 characters).');
  assert.deepEqual(long.edits, {});
});

test('entry fields repeated down the screen fill like a list; one row on an entry screen fills the fields that follow', () => {
  const rows = plan(repeated(), '4:20', 'A\t1\nB\t2\nC\t3\nD\t4');
  assert.equal(rows.kind, 'rows');
  assert.deepEqual(rows.edits, { '4:20': 'A', '4:30': '1', '5:20': 'B', '5:30': '2', '6:20': 'C', '6:30': '3' }, 'it stops at the gap before Notes');
  assert.equal(rows.extraRows, 1);

  // One row wider than the line: Customer, State, Quantity, Item code in turn.
  const fields = plan(orderEntry(), '4:20', 'C00042\tny\t12\t7');
  assert.equal(fields.kind, 'fields');
  assert.deepEqual(fields.columns.map((t) => t?.field.id), ['4:20', '5:20', '6:20', '7:20']);
  assert.deepEqual(fields.edits, { '4:20': 'C00042', '5:20': 'NY', '6:20': '12', '7:20': '7' });
});

test('a paste outside an entry field, or one too big, is refused', () => {
  const view = transform(orderLines());
  assert.deepEqual(planPaste(view, '1:1', 'a\tb'), { error: 'Click in an entry field first.' });
  assert.match((planPaste(view, '6:8', 'x\t'.repeat(5001)) as { error: string }).error, /^That's 5002 cells; paste at most 5000/);
  assert.equal(pasteGrid(view, '6:8', 1, 1)?.kind, 'list');
});

const field = (over: Partial<FieldSnapshot> = {}): FieldSnapshot => ({
  id: '1:1', row: 1, col: 1, length: 10, value: '', bypass: false, modified: false, mandatoryEnter: false, attr: {} as FieldSnapshot['attr'], ...over,
});
const value = (cell: string, widget?: Widget, f = field()) => {
  const v = fieldValue(cell, { field: f, name: 'x', ...(widget ? { widget } : {}) });
  return 'value' in v ? v.value : `! ${v.problem}`;
};

test('widgets take what a spreadsheet holds: a choice\'s label, yes and no, ISO dates and times', () => {
  const select: Widget = { type: 'select', options: [{ value: 'U', label: 'UPS' }, { value: 'F', label: 'FedEx' }] };
  assert.equal(value('F', select), 'F');
  assert.equal(value('fedex', select), 'F');
  assert.equal(value('DHL', select), '! “DHL” isn\'t one of the choices (UPS, FedEx).');
  const check: Widget = { type: 'checkbox', on: 'Y', off: 'N' };
  assert.deepEqual(['Y', 'yes', 'TRUE', 'x', 'N', 'no', 'FALSE', '0'].map((c) => value(c, check)), ['Y', 'Y', 'Y', 'Y', 'N', 'N', 'N', 'N']);
  assert.equal(value('maybe', check), '! “maybe” isn\'t on or off (Y or N, or yes or no).');
  const date: Widget = { type: 'date', format: 'MMDDYYYY' };
  assert.equal(value('2026-12-01', date), '12012026');
  assert.equal(value('12012026', date), '12012026');
  assert.equal(value('1/12/2026', date), '! “1/12/2026” isn\'t a date as MMDDYYYY or YYYY-MM-DD.');
  assert.equal(value('9:05', { type: 'time', format: 'HHMMSS' }), '090500');
  assert.equal(value('555-12-3456', { type: 'mask', mask: '999-99-9999' }), '555123456');
  assert.equal(value('Anything', { type: 'lookup', options: [{ value: 'A', label: 'Apple' }] }), 'Anything');
  assert.equal(value('apple', { type: 'lookup', options: [{ value: 'A', label: 'Apple' }] }), 'A');
  // A widget's value still goes through the field's rules.
  assert.equal(value('fedex', select, field({ length: 1, monocase: true })), 'F');
  assert.equal(value('  padded  '), 'padded');
});

test('a customization\'s widgets apply in a list\'s columns', () => {
  const p = plan(orderLines(), '6:8', 'A1\t1\t2026-12-01', {
    id: 'order-lines', changes: [{ op: 'widget', field: '6:25', widget: { type: 'date', format: 'YYYYMMDD' } }],
  } as unknown as Parameters<typeof customize>[1]);
  assert.equal(p.edits['6:25'], '20261201');
});
