import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getCodepage, monocase } from '../src/index.ts';

const cp = getCodepage(37);

test('round-trips printable text through CCSID 37', () => {
  const text = 'Sign On  System . . . : QPADEV0001 [a-z] {0-9} $@#|!¢¬';
  assert.equal(cp.decode(cp.encode(text)), text);
});

test('maps well-known code points', () => {
  assert.deepEqual(cp.encode('A1 '), [0xc1, 0xf1, 0x40]);
  assert.equal(cp.decodeChar(0x5b), '$');
  assert.equal(cp.decodeChar(0x22), ' ', 'attribute bytes display as blanks');
});

test('CCSID 1047 differs from 37 only in [ ] ^ ¬ Ý ¨', () => {
  const z = getCodepage(1047);
  assert.deepEqual(z.encode('[]^¬Ý¨'), [0xad, 0xbd, 0x5f, 0xb0, 0xba, 0xbb]);
  assert.deepEqual(cp.encode('[]^¬Ý¨'), [0xba, 0xbb, 0xb0, 0x5f, 0xad, 0xbd]);
  const text = 'LISTCAT ENT(\'SYS1.PROCLIB\') {a|b} $@#';
  assert.deepEqual(z.encode(text), cp.encode(text));
  assert.equal(z.decode(z.encode(text)), text);
});

test('unknown CCSIDs are refused', () => {
  assert.throws(() => getCodepage(9999), /CCSID 9999 is not registered/);
});

test('CCSID 273 (Germany/Austria) maps umlauts and moved symbols', () => {
  const de = getCodepage(273);
  assert.deepEqual(de.encode('ÄÖÜäöüß§@[]{}'), [0x4a, 0xe0, 0x5a, 0xc0, 0x6a, 0xd0, 0xa1, 0x7c, 0xb5, 0x63, 0xfc, 0x43, 0xdc]);
  assert.deepEqual(de.encode('ABC xyz 0123'), cp.encode('ABC xyz 0123'), 'letters and digits match CCSID 37');
  const text = 'Anmelden  System . . . : PUB400 Größe ÄÖÜ [a] {b} @ \\ | ! ~ ^';
  assert.equal(de.decode(de.encode(text)), text);
});

test('CCSID 273 differs from 37 at exactly these 22 bytes', () => {
  const de = getCodepage(273);
  // From the cp037 and cp273 codecs: byte, then 37's character, then 273's.
  const moved: [number, string, string][] = [
    [0x43, 'ä', '{'], [0x4a, '¢', 'Ä'], [0x4f, '|', '!'], [0x59, 'ß', '~'], [0x5a, '!', 'Ü'], [0x5f, '¬', '^'],
    [0x63, 'Ä', '['], [0x6a, '¦', 'ö'], [0x7c, '@', '§'], [0xa1, '~', 'ß'], [0xb0, '^', '¢'], [0xb5, '§', '@'],
    [0xba, '[', '¬'], [0xbb, ']', '|'], [0xbc, '¯', '‾'], [0xc0, '{', 'ä'], [0xcc, 'ö', '¦'], [0xd0, '}', 'ü'],
    [0xdc, 'ü', '}'], [0xe0, '\\', 'Ö'], [0xec, 'Ö', '\\'], [0xfc, 'Ü', ']'],
  ];
  for (const [byte, us, german] of moved) {
    assert.equal(cp.decodeChar(byte), us, `37 at ${byte.toString(16)}`);
    assert.equal(de.decodeChar(byte), german, `273 at ${byte.toString(16)}`);
  }
  const movedBytes = new Set(moved.map(([b]) => b));
  for (let b = 0x40; b < 0x100; b++) {
    if (!movedBytes.has(b)) assert.equal(de.decodeChar(b), cp.decodeChar(b), `273 and 37 agree at ${b.toString(16)}`);
  }
});

test('every byte decodes and encodes back to itself, in every built-in code page', () => {
  const bytes = Array.from({ length: 256 }, (_, i) => i);
  for (const ccsid of [37, 273, 1047]) {
    const page = getCodepage(ccsid);
    const text = bytes.map((b) => page.decodeChar(b)).join('');
    // Bytes below 0x40 are controls and attributes, which display as blanks; the rest are one character each.
    const printable = bytes.slice(0x41);
    assert.deepEqual(page.encode(printable.map((b) => page.decodeChar(b)).join('')), printable, `CCSID ${ccsid}`);
    assert.equal(new Set(text.slice(0x41)).size, 0xff - 0x40, `CCSID ${ccsid} has no character twice`);
  }
});

test('monocase uppercases only to one Latin-1 character, so text keeps its length', () => {
  assert.equal(monocase('müller'), 'MÜLLER');
  assert.equal(monocase('größe'), 'GRÖßE', 'ß has no one-character uppercase');
  assert.equal(monocase('ÿ µ é'), 'ÿ µ É', 'Ÿ and Μ are not Latin-1');
  assert.equal(monocase('ABC 123 $@#'), 'ABC 123 $@#');
});
