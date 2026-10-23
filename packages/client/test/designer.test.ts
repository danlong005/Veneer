import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matches } from '@veneer/screens';
import {
  formatOptions, isHidden, newDefinition, originalText, parseOptions, resolveSelection,
  setHidden, setRole, setText, setWidget, slug, suggestMatch, textOf, widgetOf,
} from '../src/designer/edit.ts';
import { transform } from '../src/transform/index.ts';
import { mainMenu, orderEntry, workWithJobs } from './screens.ts';

test('suggests the title and a program name as match rules', () => {
  assert.deepEqual(suggestMatch(mainMenu()), [
    { row: 1, col: 2, text: 'MAIN' },
    { row: 1, col: 33, text: 'IBM i Main Menu' },
  ]);
  const snap = workWithJobs();
  const def = newDefinition(snap, transform(snap));
  assert.equal(def.id, 'work-with-active-jobs');
  assert.ok(matches(snap, def), 'a new definition matches the screen it was made on');
  assert.ok(!matches(mainMenu(), def));
});

test('edits changes per target without duplicates', () => {
  const snap = orderEntry();
  let def = newDefinition(snap, transform(snap));
  const at = { row: 4, col: 3 };
  def = setText(setText(def, at, 'Customer #'), at, 'Customer number');
  def = setRole(setHidden(def, at, true), at, 'emphasis');
  assert.equal(textOf(def, at), 'Customer number');
  assert.ok(isHidden(def, at));
  assert.equal(def.changes.length, 3);
  def = setHidden(setText(def, at, null), at, false);
  assert.deepEqual(def.changes.map((c) => c.op), ['role']);

  def = setWidget(def, '5:20', { type: 'checkbox', on: 'Y', off: 'N' });
  def = setWidget(def, '5:20', { type: 'date', format: 'MMDDYY' });
  assert.equal(widgetOf(def, '5:20')?.type, 'date');
  assert.equal(setWidget(def, '5:20', null).changes.length, 1);
});

test('resolves clicks to fields first, then items', () => {
  const snap = orderEntry();
  const view = transform(snap);
  assert.equal(resolveSelection(view, snap, { row: 5, col: 20 })?.kind, 'field');
  const label = resolveSelection(view, snap, { row: 4, col: 5 });
  assert.equal(label?.kind, 'item');
  assert.deepEqual(label?.at, { row: 4, col: 3 }, 'normalised to the item start');
  assert.deepEqual(originalText(snap, { row: 4, col: 3, width: 8 }), { row: 4, col: 3, text: 'Customer' });
});

test('option lists round-trip through value=Label lines', () => {
  const opts = parseOptions('TX=Texas\n CA = California \n\nNY');
  assert.deepEqual(opts, [{ value: 'TX', label: 'Texas' }, { value: 'CA', label: 'California' }, { value: 'NY', label: 'NY' }]);
  assert.equal(formatOptions(opts), 'TX=Texas\nCA=California\nNY=NY');
  assert.equal(slug('Work with Active Jobs!'), 'work-with-active-jobs');
});
