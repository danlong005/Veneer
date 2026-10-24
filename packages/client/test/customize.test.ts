import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchScreen, type ScreenDefinition } from '@veneer/screens';
import { customize, itemAt } from '../src/transform/customize.ts';
import { transform, type FieldItem, type TextItem } from '../src/transform/index.ts';
import { orderEntry, promptWindow, workWithJobs } from './screens.ts';

const def: ScreenDefinition = {
  id: 'order-entry',
  name: 'Order Entry',
  match: { text: [{ row: 1, col: 33, text: 'Order Entry' }] },
  title: 'New order',
  changes: [
    { op: 'text', at: { row: 4, col: 3 }, text: 'Customer number' },
    { op: 'role', at: { row: 4, col: 3 }, role: 'emphasis' },
    { op: 'hide', at: { row: 7, col: 5 } },
    { op: 'widget', field: '5:20', widget: { type: 'select', options: [{ value: 'TX', label: 'Texas' }] } },
    { op: 'button', label: 'Exit', action: { aid: 'F3' } },
  ],
};

test('applies title, text, role, widget, hide and buttons', () => {
  const snap = orderEntry();
  assert.equal(matchScreen(snap, [def])?.id, 'order-entry');
  const v = customize(transform(snap), def);
  assert.equal(v.title, 'New order');
  assert.deepEqual(v.definition, { id: 'order-entry', name: 'Order Entry' });
  const label = itemAt(v.items, { row: 4, col: 3 }) as TextItem;
  assert.equal(label.text, 'Customer number');
  assert.equal(label.role, 'emphasis');
  assert.equal(itemAt(v.items, { row: 7, col: 3 }), undefined, 'item code label hidden (any cell of it)');
  const state = v.items.find((i): i is FieldItem => i.kind === 'field' && i.field.id === '5:20')!;
  assert.equal(state.widget?.type, 'select');
  assert.deepEqual(v.buttons, [{ label: 'Exit', action: { aid: 'F3' } }]);
});

test('design mode keeps hidden items, marked', () => {
  const v = customize(transform(orderEntry()), def, { design: true });
  assert.equal(itemAt(v.items, { row: 7, col: 3 })?.hidden, true);
});

test('changes reach items inside a pop-up window', () => {
  const v = customize(transform(promptWindow()), {
    id: 'w', name: 'W', match: { text: [{ row: 8, col: 30, text: 'Select Printer' }] },
    changes: [{ op: 'text', at: { row: 12, col: 22 }, text: 'Printer name' }],
  });
  assert.ok(v.window!.items.some((i) => i.kind === 'text' && i.text === 'Printer name'));
});

test('custom HTML is placed on the screen, or in the window it falls inside; CSS and script carry over', () => {
  const v = customize(transform(orderEntry()), {
    ...def, css: '.x {}', scripts: { load: 'return 1' },
    changes: [{ op: 'html', at: { row: 4, col: 3 }, html: '<b>Hi</b>', width: 10, height: 2, css: 'color: red;', script: 'element' }],
  });
  assert.equal(v.css, '.x {}');
  assert.deepEqual(v.scripts, { load: 'return 1' });
  const html = itemAt(v.items, { row: 5, col: 5 });
  assert.equal(html?.kind, 'html', 'covers its second row and wins over the label beneath');
  assert.equal(html?.kind === 'html' && `${html.css}|${html.script}`, 'color: red;|element');

  const w = customize(transform(promptWindow()), {
    id: 'w', name: 'W', match: { text: [{ row: 8, col: 30, text: 'Select Printer' }] },
    changes: [{ op: 'html', at: { row: 12, col: 22 }, html: 'in', width: 5, height: 1 }, { op: 'html', at: { row: 2, col: 2 }, html: 'out', width: 5, height: 1 }],
  });
  assert.ok(w.window!.items.some((i) => i.kind === 'html' && i.html === 'in'));
  assert.ok(w.items.some((i) => i.kind === 'html' && i.html === 'out'));
});

test('moves draw items elsewhere; other changes and the designer still find them at home', () => {
  const v = customize(transform(orderEntry()), {
    ...def,
    changes: [
      { op: 'move', at: { row: 4, col: 3 }, to: { row: 2, col: 60 } },
      { op: 'text', at: { row: 4, col: 3 }, text: 'Customer number' },
    ],
  });
  const label = itemAt(v.items, { row: 4, col: 3 }) as TextItem;
  assert.equal(label.text, 'Customer number', 'text change applied though listed after the move');
  assert.deepEqual([label.row, label.col, label.home], [2, 60, { row: 4, col: 3 }]);
  assert.equal(v.items.indexOf(label), v.items.findIndex((i) => i.row >= 2), 'tab order follows the new place');
});

test('moving a table moves its rows and columns with it', () => {
  const view = transform(workWithJobs());
  const table = view.items.find((i) => i.kind === 'table')!;
  const v = customize(view, { id: 'j', name: 'J', match: { text: [{ row: 1, col: 1, text: 'x' }] },
    changes: [{ op: 'move', at: { row: table.row, col: table.col }, to: { row: table.row + 1, col: table.col + 2 } }] });
  const moved = v.items.find((i) => i.kind === 'table')!;
  assert.ok(moved.kind === 'table' && table.kind === 'table');
  assert.equal(moved.rows[0]!.row - moved.row, table.rows[0]!.row - table.row, 'rows keep their place in the table');
  assert.equal(moved.columns[1]!.col - moved.col, table.columns[1]!.col - table.col);
});

test('no definition leaves the view untouched', () => {
  const view = transform(orderEntry());
  assert.equal(customize(view, undefined), view);
});
