import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Change } from '@veneer/screens';
import { describeChange, labelText, nameAt } from '../src/designer/changes.ts';
import { orderEntry } from './screens.ts';

const snap = orderEntry();
const line = (c: Change) => describeChange(c, snap);

test('names a position by its text or field', () => {
  assert.equal(nameAt(snap, { row: 4, col: 3 }), '“Customer”');
  assert.equal(nameAt(snap, { row: 4, col: 20 }), 'field 4:20');
  assert.equal(nameAt(snap, { row: 20, col: 70 }), 'row 20, column 70');
});

test('reads labels without dot leaders or a colon', () => {
  assert.equal(labelText('Customer . . . . . :  ______'), 'Customer');
  assert.equal(labelText('Ship date . . .'), 'Ship date');
  assert.equal(labelText('Name:'), 'Name');
  assert.equal(labelText('Y=Yes, N=No   more'), 'Y=Yes, N=No');
  assert.equal(labelText('Version 7.5'), 'Version 7.5');
});

test('describes changes that apply to a position, with the position', () => {
  assert.deepEqual(line({ op: 'hide', at: { row: 4, col: 3 } }), { label: 'Hide “Customer”', at: { row: 4, col: 3 } });
  assert.equal(line({ op: 'text', at: { row: 4, col: 3 }, text: 'Customer number' }).label, 'Change “Customer” to “Customer number”');
  assert.equal(line({ op: 'role', at: { row: 4, col: 3 }, role: 'danger' }).label, 'Show “Customer” as Error');
  assert.equal(line({ op: 'move', at: { row: 4, col: 3 }, to: { row: 6, col: 3 } }).label, 'Move “Customer” to row 6, column 3');
  assert.deepEqual(
    line({ op: 'widget', field: '5:20', widget: { type: 'checkbox', on: 'Y', off: 'N' } }),
    { label: 'Show field 5:20 as a checkbox', at: { row: 5, col: 20 } },
  );
  assert.equal(line({ op: 'html', at: { row: 10, col: 2 }, html: '<b>Hello</b> <i>there</i>', width: 10, height: 1 }).label, 'HTML “Hello there”');
});

test('describes page-wide changes without a position', () => {
  assert.deepEqual(line({ op: 'button', label: 'Back', action: { aid: 'F12' } }), { label: 'Button “Back”: presses F12' });
  assert.equal(line({ op: 'button', label: 'Map', action: { url: 'https://example.com' } }).label, 'Button “Map”: opens a web page');
  assert.equal(line({ op: 'tabs', tabs: [{ title: 'Main', from: 3, to: 10 }, { title: '', from: 11, to: 20 }] }).label, 'Tabs: Main, Untitled');
  const rule = line({ op: 'style', when: { column: 'Status', equals: 'MSGW' }, role: 'danger', target: 'row' });
  assert.deepEqual(rule, { label: 'Error when column “Status” is “MSGW”' });
});

test('clips long text', () => {
  const label = line({ op: 'text', at: { row: 4, col: 3 }, text: 'x'.repeat(60) }).label;
  assert.ok(label.endsWith('…”'));
  assert.ok(label.length < 80);
});
