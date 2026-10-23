import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkFields, filterValue, withSign } from '../src/ui/fieldRules.ts';
import { caretAtCursor, replay, type TypedKey } from '../src/ui/typeahead.ts';
import { orderEntry } from './screens.ts';

const chars = (s: string): TypedKey[] => [...s].map((ch) => ({ kind: 'char', ch }));
const field = (id: string) => orderEntry().fields.find((f) => f.id === id)!;

test('numeric fields accept digits and signs only; digits-only accepts digits', () => {
  assert.equal(filterValue(field('6:20'), '1a2-'), '12-');
  assert.equal(filterValue(field('7:20'), '1-2.'), '12');
  assert.equal(filterValue(field('4:20'), 'ACME!'), 'ACME!');
});

test('Field+ and Field- set the sign', () => {
  assert.equal(withSign('12', true), '12-');
  assert.equal(withSign('-12', false), '12');
  assert.equal(withSign('12-', true), '12-');
  assert.equal(withSign('', true), '');
});

test('mandatory enter and mandatory fill are checked before Enter', () => {
  const { fields } = orderEntry();
  assert.equal(checkFields(fields, {})?.id, '4:20');
  assert.equal(checkFields(fields, { '4:20': 'ACME' }), null);
  assert.match(checkFields(fields, { '4:20': 'ACME', '5:20': 'T' })!.message, /completely filled/);
  assert.equal(checkFields(fields, { '4:20': 'ACME', '5:20': 'TX' }), null);
});

test('type-ahead skips characters a field rejects and auto-enters a full field', () => {
  const snap = orderEntry();
  const start = { edits: {}, caret: { id: '6:20', offset: 0 } };
  const r = replay(snap, start, [...chars('1x0-'), { kind: 'tab', back: false }, ...chars('a42'), ...chars('7z')]);
  assert.deepEqual(r.state.edits, { '6:20': '10-', '7:20': '427' });
  assert.equal(r.aid, 'Enter', 'item code is auto-enter');
  assert.deepEqual(r.rest, chars('z'));
  assert.ok(caretAtCursor(snap));
});
