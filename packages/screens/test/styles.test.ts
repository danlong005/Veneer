import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conditionTester, parseNumber, validateDefinition } from '../src/index.ts';

test('reads numbers as 5250 screens show them', () => {
  const cases: Array<[string, number | undefined]> = [
    ['12', 12], ['  -12.50 ', -12.5], ['12.50-', -12.5], ['12,50', 12.5], ['-12,50', -12.5], ['1,234.50', 1234.5],
    ['1.234,50', 1234.5], ['1,234', 1234], ['1.234.567', 1234567], ['.5', 0.5], ['100.00 CR', -100], ['+7', 7],
    ['', undefined], ['N/A', undefined], ['1.2.3', undefined], ['-', undefined],
  ];
  for (const [text, want] of cases) assert.equal(parseNumber(text), want, JSON.stringify(text));
});

test('text tests ignore case and spaces; number tests read numbers', () => {
  assert.equal(conditionTester({ column: 'S', equals: 'msgw' })(' MSGW '), true);
  assert.equal(conditionTester({ column: 'S', equals: 'MSGW' })('MSGWX'), false);
  assert.equal(conditionTester({ column: 'S', contains: 'err' })('CPF ERROR'), true);
  assert.equal(conditionTester({ column: 'S', matches: '^(MSGW|LCKW)$' })('lckw'), true);
  const negative = conditionTester({ column: 'Amount', lessThan: 0 });
  assert.deepEqual(['12.50-', '12.50', '', 'n/a'].map(negative), [true, false, false, false]);
});

test('validates style rules', () => {
  const base = { id: 'x', name: 'X', match: { text: [{ row: 1, col: 1, text: 'X' }] } };
  const ok = validateDefinition({ ...base, changes: [{ op: 'style', when: { column: 'Status', equals: 'MSGW' }, role: 'danger', target: 'row' }] });
  assert.deepEqual(ok.changes[0], { op: 'style', when: { column: 'Status', equals: 'MSGW' }, role: 'danger', target: 'row' });
  const bad: Array<[unknown, RegExp]> = [
    [{ column: 'S', at: { row: 1, col: 1 }, equals: 'X' }, /either column or at/],
    [{ column: 'S' }, /exactly one/],
    [{ column: 'S', equals: 'X', contains: 'Y' }, /exactly one/],
    [{ column: 'S', lessThan: '5' }, /number/],
    [{ column: 'S', matches: '(' }, /regular expression/],
  ];
  for (const [when, why] of bad) {
    assert.throws(() => validateDefinition({ ...base, changes: [{ op: 'style', when, role: 'danger', target: 'row' }] }), why);
  }
  assert.throws(() => validateDefinition({ ...base, changes: [{ op: 'style', when: { column: 'S', equals: 'X' }, role: 'danger', target: 'item' }] }), /row or cell/);
  assert.throws(() => validateDefinition({ ...base, changes: [{ op: 'style', when: { at: { row: 1, col: 1 }, equals: 'X' }, role: 'danger', target: 'row' }] }), /item/);
});
