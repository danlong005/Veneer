import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIMIT, MERGE_MS, record, redo, startHistory, undo } from '../src/designer/history.ts';

test('undo and redo step through separate edits', () => {
  let h = startHistory('a');
  h = record(h, 'b', 1000);
  h = record(h, 'c', 1000 + MERGE_MS);
  assert.equal(h.present, 'c');
  h = undo(h);
  assert.equal(h.present, 'b');
  h = undo(h);
  assert.equal(h.present, 'a');
  assert.equal(undo(h), h, 'nothing left to undo');
  h = redo(redo(h));
  assert.equal(h.present, 'c');
  assert.equal(redo(h), h, 'nothing left to redo');
});

test('edits close together make one step', () => {
  let h = startHistory('');
  for (const [i, text] of ['N', 'Na', 'Nam', 'Name'].entries()) h = record(h, text, 5000 + i * 200);
  assert.deepEqual(h.past, ['']);
  assert.equal(undo(h).present, '');
});

test('after an undo, the next edit starts a new step and drops the redo', () => {
  let h = record(startHistory('a'), 'b', 1000);
  h = undo(h);
  h = record(h, 'x', 1100);
  assert.deepEqual(h.past, ['a']);
  assert.deepEqual(h.future, []);
  h = record(h, 'xy', 1200);
  assert.deepEqual(h.past, ['a'], 'joins the step it started');
});

test('an edit that changes nothing is not a step', () => {
  const h = record(startHistory({ a: 1 }), { a: 1 }, 1000);
  assert.deepEqual(h.past, []);
});

test('keeps at most LIMIT steps', () => {
  let h = startHistory(0);
  for (let i = 1; i <= LIMIT + 10; i++) h = record(h, i, i * MERGE_MS);
  assert.equal(h.past.length, LIMIT);
  assert.equal(h.past[0], 10);
});
