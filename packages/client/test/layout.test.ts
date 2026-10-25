import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Change, ScreenDefinition, TabBand } from '@veneer/screens';
import { customize } from '../src/transform/customize.ts';
import { transform, type Item, type TextItem } from '../src/transform/index.ts';
import { cardAround, cardsOf, moveTabEdge, removeTab, setCard, setTabs, splitTabs, tabsOf } from '../src/designer/edit.ts';
import { layoutOf, tabAtCursor, viewRow } from '../src/ui/layout.ts';
import { orderEntry, promptWindow } from './screens.ts';

const def = (changes: Change[]): ScreenDefinition => ({ id: 'x', name: 'X', match: { text: [] }, changes });
const bands: TabBand[] = [
  { title: 'Customer', from: 4, to: 4 },
  { title: 'Address', from: 5, to: 5 },
  { title: 'Order', from: 6, to: 6 },
];
const labels = (items: Item[]) => items.filter((i): i is TextItem => i.kind === 'text').map((i) => i.text.trim());

test('tabs split rows into bands under a strip, and rows below move up', () => {
  const view = customize(transform(orderEntry()), def([{ op: 'tabs', tabs: bands }]));
  const layout = layoutOf(view);
  const t = layout.tabs!;
  assert.equal(t.row, 4, 'the strip takes the first band row');
  assert.equal(t.height, 1);
  assert.deepEqual(t.panels.map((p) => labels(p.items)), [['Customer'], ['State'], ['Quantity']]);
  assert.deepEqual(t.panels.map((p) => [p.row, p.from]), [[5, 4], [5, 5], [5, 6]], 'each band is drawn on the row after the strip');
  assert.deepEqual(labels(t.after.items), ['Item code']);
  assert.deepEqual([t.after.row, t.after.from], [6, 7], 'row 7 moves up to row 6: one band shows instead of three');
  assert.deepEqual([layout.top, layout.bottom], [4, 6]);
  // Every field is still in the layout, hidden tabs too, so its value is sent.
  const fields = [...layout.main.items, ...t.panels.flatMap((p) => p.items), ...t.after.items].filter((i) => i.kind === 'field');
  assert.equal(fields.length, 4);
});

test('moved items go to the tab they are drawn in', () => {
  const view = customize(transform(orderEntry()), def([
    { op: 'move', at: { row: 7, col: 3 }, to: { row: 4, col: 40 } },
    { op: 'move', at: { row: 7, col: 20 }, to: { row: 4, col: 52 } },
    { op: 'tabs', tabs: bands },
  ]));
  const layout = layoutOf(view);
  assert.deepEqual(labels(layout.tabs!.panels[0]!.items), ['Customer', 'Item code']);
  assert.deepEqual(layout.tabs!.after.items, []);
  // The host's cursor is found where the host put the field, shown in the tab it moved to.
  assert.equal(tabAtCursor(layout, view, { row: 7, col: 20 }), 0);
  assert.equal(tabAtCursor(layout, view, { row: 6, col: 20 }), 2);
  assert.equal(tabAtCursor(layout, view, { row: 6, col: 70 }), 2, 'a blank cell: its own row');
  assert.equal(tabAtCursor(layout, view, { row: 2, col: 1 }), 0, 'outside the tabs: the first');
});

test('layout rows map back to screen rows for the tab showing', () => {
  const layout = layoutOf(customize(transform(orderEntry()), def([{ op: 'tabs', tabs: bands }])));
  assert.equal(viewRow(layout, 3, 1), 3, 'above the tabs');
  assert.equal(viewRow(layout, 4, 1), undefined, 'the strip');
  assert.equal(viewRow(layout, 5, 0), 4);
  assert.equal(viewRow(layout, 5, 2), 6);
  assert.equal(viewRow(layout, 6, 2), 7, 'below the tabs');
  assert.equal(viewRow(layoutOf(transform(orderEntry())), 5, 0), 5, 'no tabs');
});

test('cards go with the rows they start on; a pop-up window keeps the host rows', () => {
  const view = customize(transform(orderEntry()), def([
    { op: 'tabs', tabs: bands },
    { op: 'card', from: { row: 5, col: 2 }, to: { row: 5, col: 30 }, title: 'Where' },
    { op: 'card', from: { row: 7, col: 2 }, to: { row: 7, col: 30 } },
  ]));
  const t = layoutOf(view).tabs!;
  assert.deepEqual(t.panels[1]!.cards, [{ top: 5, left: 2, bottom: 5, right: 30, title: 'Where' }]);
  assert.deepEqual(t.after.cards, [{ top: 7, left: 2, bottom: 7, right: 30 }]);

  const win = customize(transform(promptWindow()), def([{ op: 'tabs', tabs: bands }]));
  assert.ok(win.window && win.tabs);
  const layout = layoutOf(win);
  assert.equal(layout.tabs, undefined);
  assert.equal(layout.main.items, win.items);
});

test('designer: start, merge and resize tabs', () => {
  const region = { from: 4, to: 7 };
  const two = splitTabs([], 6, region);
  assert.deepEqual(two, [{ title: 'Tab 1', from: 4, to: 5 }, { title: 'Tab 2', from: 6, to: 7 }]);
  assert.deepEqual(splitTabs([], 4, region), []);
  assert.equal(splitTabs(two, 6, region), two, 'already starts a tab');
  const three = splitTabs(two, 5, region);
  assert.deepEqual(three.map((t) => [t.title, t.from, t.to]), [['Tab 1', 4, 4], ['Tab 3', 5, 5], ['Tab 2', 6, 7]]);
  assert.deepEqual(removeTab(three, 1).map((t) => [t.from, t.to]), [[4, 5], [6, 7]], 'rows join the tab before');
  assert.deepEqual(removeTab(three, 0).map((t) => [t.from, t.to]), [[4, 5], [6, 7]], 'the first tab joins the next');
  assert.deepEqual(removeTab(two, 0), [], 'one tab is no tabs');
  assert.deepEqual(moveTabEdge(three, 2, 9).map((t) => [t.from, t.to]), [[4, 4], [5, 6], [7, 7]], 'kept a row each');
  assert.deepEqual(moveTabEdge(three, 3, 12).at(-1), { title: 'Tab 2', from: 6, to: 12 });
  assert.deepEqual(moveTabEdge(three, 0, 2)[0], { title: 'Tab 1', from: 2, to: 4 });

  const d = setTabs(def([{ op: 'hide', at: { row: 1, col: 1 } }]), two);
  assert.deepEqual(tabsOf(d), two);
  assert.deepEqual(tabsOf(setTabs(d, three)), three);
  assert.equal(setTabs(d, three).changes.length, 2, 'replaced, not added');
  assert.deepEqual(setTabs(d, []).changes, [{ op: 'hide', at: { row: 1, col: 1 } }]);
});

test('designer: add, retitle and remove cards', () => {
  const view = transform(orderEntry());
  const field = view.items.find((i) => i.kind === 'field')!;
  const card = cardAround(field);
  assert.deepEqual(card, { from: { row: 4, col: 20 }, to: { row: 4, col: 20 + field.width - 1 } });
  let d = setCard(def([]), card.from, card);
  d = setCard(d, card.from, { ...card, title: 'Who' });
  assert.deepEqual(cardsOf(d), [{ ...card, title: 'Who' }]);
  assert.deepEqual(setCard(d, card.from, null).changes, []);
});
