import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gridText } from '../src/ui/copyText.ts';

test('copied screen text has a line per row, each piece at its column', () => {
  // An ISPF View screen: line numbers as text, the data in input fields.
  const text = gridText([
    { row: 4, col: 1, text: '000100' },
    { row: 4, col: 8, text: '//JOB1    JOB  (ACCT)' },
    { row: 5, col: 1, text: '000200' },
    { row: 5, col: 8, text: '//STEP1   EXEC PGM=IEFBR14' },
  ]);
  assert.equal(text, '000100 //JOB1    JOB  (ACCT)\n000200 //STEP1   EXEC PGM=IEFBR14');
});

test('pieces are put in column order, whatever order they come in', () => {
  assert.equal(gridText([{ row: 0, col: 10, text: 'B' }, { row: 0, col: 0, text: 'A' }]), 'A         B');
});

test('blank rows between are kept, trailing blanks and the shared indent dropped', () => {
  const text = gridText([
    { row: 2, col: 6, text: 'Menu  ' },
    { row: 4, col: 8, text: 'Option ===>' },
  ]);
  assert.equal(text, 'Menu\n\n  Option ===>');
});

test('a piece that starts inside the text before it gets a space, not run into it', () => {
  // A proportional label can be wider than its cells; its words still stay apart.
  assert.equal(gridText([{ row: 0, col: 0, text: 'Command' }, { row: 0, col: 4, text: '===>' }]), 'Command ===>');
});

test('nothing selected copies nothing', () => {
  assert.equal(gridText([]), '');
  assert.equal(gridText([{ row: 0, col: 3, text: '' }]), '');
});
