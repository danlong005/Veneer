import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setText } from '../src/designer/edit.ts';
import { labelAt, labelText, nameAt } from '../src/designer/names.ts';
import { customize } from '../src/transform/customize.ts';
import { transform } from '../src/transform/index.ts';
import { orderEntry, workWithJobs } from './screens.ts';

test('reads labels without dot leaders or a colon', () => {
  assert.equal(labelText('Customer . . . . . :  ______'), 'Customer');
  assert.equal(labelText('Ship date . . .'), 'Ship date');
  assert.equal(labelText('Name:'), 'Name');
  assert.equal(labelText('Y=Yes, N=No   more'), 'Y=Yes, N=No');
  assert.equal(labelText('Version 7.5'), 'Version 7.5');
});

test('names an input field by its label, text by what the host shows', () => {
  const snap = orderEntry();
  const view = transform(snap);
  assert.equal(labelAt(view, snap, { row: 5, col: 20 }), 'State');
  assert.equal(labelAt(view, snap, { row: 7, col: 3 }), 'Item code');
  assert.equal(nameAt(view, snap, { row: 4, col: 20 }), '“Customer”');
  assert.equal(nameAt(view, snap, { row: 20, col: 70 }), 'row 20, column 70');
});

test('keeps the host name of text the customization changed', () => {
  const snap = orderEntry();
  const def = setText({ id: 'x', name: 'x', match: { text: [] }, changes: [] }, { row: 4, col: 3 }, 'Customer number');
  const view = customize(transform(snap), def, { design: true });
  assert.equal(labelAt(view, snap, { row: 4, col: 3 }), 'Customer');
  assert.equal(labelAt(view, snap, { row: 4, col: 3 }, { shown: true }), 'Customer number', 'as the page shows it');
  assert.equal(labelAt(view, snap, { row: 4, col: 20 }, { shown: true }), 'Customer number', 'the field takes its new label');
  assert.equal(labelAt(view, snap, { row: 4, col: 20 }), 'Customer');
});

test('names list fields by column and row, the command line, and a list by its headings', () => {
  const snap = workWithJobs();
  const view = transform(snap);
  assert.equal(labelAt(view, snap, { row: 12, col: 3 }), 'Opt, row 2');
  assert.equal(labelAt(view, snap, { row: 21, col: 7 }), 'Command line');
  assert.match(labelAt(view, snap, { row: 11, col: 7 }) ?? '', /^List of Opt, Subsystem\/Job, User/);
});
