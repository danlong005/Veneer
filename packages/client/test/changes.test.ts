import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Change } from '@veneer/screens';
import { describeChange } from '../src/designer/changes.ts';
import { transform } from '../src/transform/index.ts';
import { orderEntry } from './screens.ts';

const snap = orderEntry();
const view = transform(snap);
const line = (c: Change) => describeChange(c, view, snap);

test('describes changes that apply to a position, with the position', () => {
  assert.deepEqual(line({ op: 'hide', at: { row: 4, col: 3 } }), { label: 'Hide “Customer”', at: { row: 4, col: 3 } });
  assert.equal(line({ op: 'text', at: { row: 4, col: 3 }, text: 'Customer number' }).label, 'Change “Customer” to “Customer number”');
  assert.equal(line({ op: 'role', at: { row: 4, col: 3 }, role: 'danger' }).label, 'Show “Customer” as Error');
  assert.equal(line({ op: 'move', at: { row: 4, col: 3 }, to: { row: 6, col: 3 } }).label, 'Move “Customer” to row 6, column 3');
  assert.deepEqual(
    line({ op: 'widget', field: '5:20', widget: { type: 'checkbox', on: 'Y', off: 'N' } }),
    { label: 'Show “State” as a checkbox', at: { row: 5, col: 20 } },
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
