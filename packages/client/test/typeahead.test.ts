import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caretAtCursor, caretPosition, replay, type TypedKey } from '../src/ui/typeahead.ts';
import { mainMenu, signOn } from './screens.ts';

const chars = (s: string): TypedKey[] => [...s].map((ch) => ({ kind: 'char', ch }));
const tab: TypedKey = { kind: 'tab', back: false };
const enter: TypedKey = { kind: 'aid', aid: 'Enter' };

test('replays characters from the host cursor and stops at an AID', () => {
  const snap = signOn();
  const r = replay(snap, { edits: {}, caret: caretAtCursor(snap) }, [...chars('bob'), tab, ...chars('pw'), enter, ...chars('x')]);
  assert.deepEqual(r.state.edits, { '6:53': 'BOB', '7:53': 'pw' });
  assert.equal(r.aid, 'Enter');
  assert.deepEqual(r.rest, chars('x'));
  assert.deepEqual(caretPosition(snap, r.state.caret!), { row: 7, col: 55 });
});

test('a full field advances to the next one', () => {
  const snap = signOn();
  const r = replay(snap, { edits: {}, caret: caretAtCursor(snap) }, chars('ABCDEFGHIJxy'));
  assert.deepEqual(r.state.edits, { '6:53': 'ABCDEFGHIJ', '7:53': 'xy' });
});

test('typing into a full field overwrites at the caret', () => {
  const snap = signOn();
  const r = replay(snap, { edits: { '6:53': 'QSECOFRXYZ' }, caret: { id: '6:53', offset: 7 } }, chars('ABC'));
  assert.equal(r.state.edits['6:53'], 'QSECOFRABC');
  assert.equal(r.state.caret?.id, '7:53');
});

test('backspace deletes before the caret; tab wraps around', () => {
  const snap = signOn();
  const r = replay(snap, { edits: {}, caret: caretAtCursor(snap) },
    [...chars('abx'), { kind: 'backspace' }, { kind: 'tab', back: true }, { kind: 'tab', back: true }, ...chars('c')]);
  assert.deepEqual(r.state.edits, { '6:53': 'CAB' }, 'tab lands at the field start');
});

test('menu type-ahead: option number then Enter', () => {
  const snap = mainMenu();
  const r = replay(snap, { edits: {}, caret: caretAtCursor(snap) }, [...chars('90'), enter]);
  assert.deepEqual(r.state.edits, { '20:7': '90' });
  assert.equal(r.aid, 'Enter');
});
