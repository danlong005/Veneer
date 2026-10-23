import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp } from './helpers.ts';

test('round-trips printable text through CCSID 37', () => {
  const text = 'Sign On  System . . . : QPADEV0001 [a-z] {0-9} $@#|!¢¬';
  assert.equal(cp.decode(cp.encode(text)), text);
});

test('maps well-known code points', () => {
  assert.deepEqual(cp.encode('A1 '), [0xc1, 0xf1, 0x40]);
  assert.equal(cp.decodeChar(0x5b), '$');
  assert.equal(cp.decodeChar(0x22), ' ', 'attribute bytes display as blanks');
});
