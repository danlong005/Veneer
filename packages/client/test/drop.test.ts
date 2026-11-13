import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ScreenDefinition } from '@veneer/screens';
import type { ScreenSnapshot } from '@veneer/terminal';
import { customize, transform } from '@veneer/view';
import { firstSpot, planDrop, spots, targetAt, type DropPlan, type PaletteItem } from '../src/designer/drop.ts';
import { componentAt, componentForField, displayOf, imageAt, labelAt, newDefinition, setComponent, setDisplay, setWidget, widgetOf } from '../src/designer/edit.ts';
import { orderEntry, orderNotes, workWithJobs } from './screens.ts';

function setup(snap: ScreenSnapshot, edit?: (d: ScreenDefinition) => ScreenDefinition) {
  const base = transform(snap);
  let def = newDefinition(snap, base);
  if (edit) def = edit(def);
  const view = customize(base, def, { design: true });
  const drop = (item: PaletteItem, row: number, col: number) => planDrop(view, snap, def, item, { row, col });
  return { def, view, drop };
}

function ok(plan: DropPlan) {
  assert.ok(plan.ok, plan.ok ? '' : plan.message);
  return plan;
}

function refused(plan: DropPlan, pattern: RegExp) {
  assert.equal(plan.ok, false);
  assert.match(plan.message, pattern);
}

test('a field widget dropped anywhere on an input field becomes that field\'s widget, and selects the field', () => {
  const { drop } = setup(orderEntry());
  // Customer is at 4:20, six characters: its last cell counts too.
  const plan = ok(drop({ kind: 'widget', type: 'select' }, 4, 25));
  assert.equal(widgetOf(plan.def, '4:20')?.type, 'select');
  assert.deepEqual(plan.select, { row: 4, col: 20 });
  assert.deepEqual(plan.box, { row: 4, col: 20, width: 6, height: 1 });
  assert.equal(plan.replaces, undefined);
  assert.match(plan.message, /Customer/);
  assert.match(plan.message, /a dropdown/);
});

test('a field widget refuses text, empty spots and the page header, and says where it goes', () => {
  const { drop } = setup(orderEntry());
  refused(drop({ kind: 'widget', type: 'date' }, 4, 4), /^A date picker goes on an input field\.$/);
  refused(drop({ kind: 'widget', type: 'date' }, 15, 40), /^A date picker goes on an input field\.$/);
});

test('nothing goes on the page header', () => {
  const { drop } = setup(workWithJobs());
  refused(drop({ kind: 'widget', type: 'date' }, 1, 74), /^A date picker goes on an input field, not on the page header\.$/);
  refused(drop({ kind: 'display', type: 'badge' }, 1, 74), /not on the page header/);
});

test('a spinner goes only on a field that takes numbers', () => {
  const { drop } = setup(orderEntry());
  ok(drop({ kind: 'widget', type: 'spinner' }, 6, 20));
  refused(drop({ kind: 'widget', type: 'spinner' }, 4, 20), /takes numbers/);
});

test('dropping on a field with a widget or component replaces it, and says what it replaces', () => {
  const { drop } = setup(orderEntry(), (d) => setWidget(d, '4:20', { type: 'date', format: 'YYYYMMDD' }));
  const plan = ok(drop({ kind: 'widget', type: 'select' }, 4, 20));
  assert.equal(plan.replaces, 'the date picker');
  assert.equal(widgetOf(plan.def, '4:20')?.type, 'select');
  assert.equal(plan.def.changes.filter((c) => c.op === 'widget').length, 1);
  refused(drop({ kind: 'widget', type: 'date' }, 4, 20), /already a date picker/);

  const withComponent = setup(orderEntry(), (d) => setComponent(d, { row: 5, col: 20 }, { name: 'scanner', at: { row: 5, col: 20 }, width: 2, height: 1, field: '5:20' }));
  const swap = ok(withComponent.drop({ kind: 'widget', type: 'select' }, 5, 21));
  assert.equal(swap.replaces, 'the scanner component');
  assert.equal(componentForField(swap.def, '5:20'), undefined);
  assert.equal(widgetOf(swap.def, '5:20')?.type, 'select');
});

test('a widget dropped on a later line of a text area is refused', () => {
  const { drop } = setup(orderNotes(), (d) => setWidget(d, '8:20', { type: 'textarea', fields: ['8:20', '9:20'] }));
  refused(drop({ kind: 'widget', type: 'select' }, 9, 22), /first line/);
  ok(drop({ kind: 'widget', type: 'select' }, 8, 22));
});

test('an output display dropped on text shows that text that way', () => {
  const { drop, view } = setup(workWithJobs());
  const title = view.items.find((i) => i.kind === 'text' && i.text === 'Parameters or command');
  assert.ok(title);
  const plan = ok(drop({ kind: 'display', type: 'badge' }, title.row, title.col + 2));
  assert.deepEqual(plan.select, { row: title.row, col: title.col });
  assert.equal(displayOf(plan.def, { at: plan.select })?.type, 'badge');
  const again = setup(workWithJobs(), () => plan.def);
  refused(again.drop({ kind: 'display', type: 'badge' }, title.row, title.col), /already shown as a status badge/);
});

test('an output display dropped on a list column shows the column that way, and names it', () => {
  const { drop } = setup(workWithJobs());
  // "CPU %" heads the column with .0, 12.5 and .1.
  const plan = ok(drop({ kind: 'display', type: 'number' }, 12, 44));
  assert.equal(plan.column, 'CPU %');
  assert.equal(displayOf(plan.def, { column: 'CPU %' })?.type, 'number');
  assert.equal(plan.box.row, 11);
  // The Opt column holds input fields; the field itself takes widgets, not displays.
  refused(drop({ kind: 'display', type: 'number' }, 11, 3), /goes on text or a list column/);
});

test('replacing a column\'s display says so', () => {
  const { drop } = setup(workWithJobs(), (d) => setDisplay(d, { column: 'CPU %' }, { type: 'progress', max: 100 }));
  assert.equal(ok(drop({ kind: 'display', type: 'number' }, 12, 44)).replaces, 'the progress bar');
});

test('an output display refuses input fields and empty spots', () => {
  const { drop } = setup(orderEntry());
  refused(drop({ kind: 'display', type: 'link' }, 4, 20), /^A link goes on text or a list column\.$/);
  refused(drop({ kind: 'display', type: 'link' }, 15, 40), /^A link goes on text or a list column\.$/);
});

test('labels and images go on empty spots, an image kept inside the screen', () => {
  const { drop } = setup(orderEntry());
  const label = ok(drop({ kind: 'label' }, 15, 40));
  assert.equal(labelAt(label.def, { row: 15, col: 40 })?.text, 'New label');
  assert.deepEqual(label.select, { row: 15, col: 40 });
  const image = ok(drop({ kind: 'image' }, 23, 75));
  const spec = imageAt(image.def, { row: 23, col: 75 });
  assert.deepEqual([spec?.width, spec?.height], [6, 2]);
  refused(drop({ kind: 'label' }, 4, 20), /^A label goes on an empty spot\.$/);
  refused(drop({ kind: 'image' }, 4, 4), /^An image goes on an empty spot\.$/);
});

test('a component on an empty spot gets the default size, clipped at the screen edge', () => {
  const { drop } = setup(orderEntry());
  const plan = ok(drop({ kind: 'component', name: 'bar-chart' }, 10, 60));
  const c = componentAt(plan.def, { row: 10, col: 60 });
  assert.deepEqual([c?.name, c?.width, c?.height, c?.field], ['bar-chart', 21, 4, undefined]);
  const corner = ok(drop({ kind: 'component', name: 'bar-chart' }, 23, 2));
  assert.equal(componentAt(corner.def, { row: 23, col: 2 })?.height, 2);
});

test('a component on an input field draws the field, in place of its widget', () => {
  const { drop } = setup(orderEntry(), (d) => setWidget(d, '4:20', { type: 'date', format: 'YYYYMMDD' }));
  const plan = ok(drop({ kind: 'component', name: 'scanner' }, 4, 22));
  assert.equal(plan.replaces, 'the date picker');
  assert.equal(widgetOf(plan.def, '4:20'), undefined);
  const c = componentForField(plan.def, '4:20');
  assert.deepEqual([c?.name, c?.at, c?.width, c?.height], ['scanner', { row: 4, col: 20 }, 6, 1]);
  assert.deepEqual(plan.select, { row: 4, col: 20 });
});

test('a component on a list covers it, and offers to hide the list, its legend and its More... marker', () => {
  const { drop, view } = setup(workWithJobs());
  const table = view.items.find((i) => i.kind === 'table');
  assert.ok(table?.kind === 'table');
  const plan = ok(drop({ kind: 'component', name: 'list-table' }, 12, 30));
  const c = componentAt(plan.def, { row: table.row, col: table.col });
  assert.deepEqual([c?.width, c?.height], [table.width, table.height]);
  assert.deepEqual(plan.select, { row: table.row, col: table.col });
  const rows = (plan.hide ?? []).map((t) => t.row).sort((a, b) => a - b);
  // "Type options" (row 7), the five options of the legend (row 8), the list, and the More... marker (row 19).
  assert.deepEqual(rows, [7, 8, 8, 8, 8, 8, 10, 19]);
});

test('nothing goes on a placed label, image or component, except a field\'s component standing for its field', () => {
  const { drop } = setup(orderEntry(), (d) => setComponent(d, { row: 10, col: 10 }, { name: 'bar-chart', at: { row: 10, col: 10 }, width: 20, height: 3 }));
  refused(drop({ kind: 'label' }, 11, 15), /not on a component/);
  refused(drop({ kind: 'widget', type: 'select' }, 11, 15), /not on a component/);
});

test('targetAt names what is under a cell', () => {
  const snap = workWithJobs();
  const view = customize(transform(snap), undefined, { design: true });
  assert.equal(targetAt(view, snap, { row: 11, col: 3 })?.kind, 'field');
  assert.equal(targetAt(view, snap, { row: 21, col: 30 })?.kind, 'field');
  assert.equal(targetAt(view, snap, { row: 12, col: 44 })?.kind, 'list');
  assert.equal(targetAt(view, snap, { row: 16, col: 40 })?.kind, 'list');
  assert.equal(targetAt(view, snap, { row: 3, col: 40 })?.kind, 'empty');
  assert.equal(targetAt(view, snap, { row: 30, col: 1 }), null);
});

test('keyboard placing starts where the item can go, and Tab steps from one place to the next', () => {
  const snap = orderEntry();
  const { def, view } = setup(snap);
  const widget: PaletteItem = { kind: 'widget', type: 'select' };
  assert.deepEqual(firstSpot(view, snap, def, widget), { row: 4, col: 20 });
  // Each field once, not each of its cells.
  assert.deepEqual(spots(view, snap, def, widget), [{ row: 4, col: 20 }, { row: 5, col: 20 }, { row: 6, col: 20 }, { row: 7, col: 20 }]);
  assert.deepEqual(spots(view, snap, def, { kind: 'widget', type: 'spinner' }).map((t) => t.row), [6, 7]);
  // A label starts on a free row; a run of empty cells counts once.
  assert.deepEqual(firstSpot(view, snap, def, { kind: 'label' }), { row: 3, col: 2 });
  const empty = spots(view, snap, def, { kind: 'label' }).filter((t) => t.row === 4).map((t) => t.col);
  assert.deepEqual(empty, [1, 11, 26]);
});
