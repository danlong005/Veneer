// Barcodes: QR codes checked module for module against a reference encoder
// (Python's qrcode package; see fixtures/qr.json), and Code 128 against the
// symbology's own rules.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { CODE128_PATTERNS, QR_MAX_BYTES, code128, code128Values, qrCode } from '../src/ui/barcode.ts';

interface Fixture { text: string; mask: number; version: number; rows: string[] }
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/qr.json', import.meta.url), 'utf8')) as Fixture[];
const asRows = (m: boolean[][]) => m.map((row) => row.map((c) => (c ? '1' : '0')).join(''));

describe('QR codes', () => {
  for (const f of fixtures) {
    test(`version ${f.version}, mask ${f.mask}: “${f.text.slice(0, 24)}${f.text.length > 24 ? '…' : ''}” matches the reference`, () => {
      assert.deepEqual(asRows(qrCode(f.text, { mask: f.mask })!), f.rows);
    });
  }

  test('the smallest version that holds the text: 21 modules a side for a few characters, 4 more per version', () => {
    assert.equal(qrCode('A')!.length, 21);
    assert.equal(qrCode('x'.repeat(14))!.length, 21, 'version 1-M holds 14 bytes');
    assert.equal(qrCode('x'.repeat(15))!.length, 25, '15 need version 2');
    assert.equal(qrCode('x'.repeat(132))!.length, 4 * 8 + 17, 'a full 132-column line: version 8');
  });

  test('finder patterns in three corners, timing lines between them', () => {
    const m = qrCode('HELLO WORLD')!;
    const n = m.length;
    const finder = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
    const at = (x0: number, y0: number) => Array.from({ length: 7 }, (_, y) => asRows(m)[y0 + y]!.slice(x0, x0 + 7));
    assert.deepEqual(at(0, 0), finder);
    assert.deepEqual(at(n - 7, 0), finder);
    assert.deepEqual(at(0, n - 7), finder);
    for (let i = 8; i < n - 8; i++) {
      assert.equal(m[6]![i], i % 2 === 0, `row 6, column ${i}`);
      assert.equal(m[i]![6], i % 2 === 0, `column 6, row ${i}`);
    }
    assert.equal(m[n - 8]![8], true, 'the dark module');
  });

  test('the best mask is one of the eight, and the same each time', () => {
    const best = asRows(qrCode('https://example.com/orders?id=12345')!);
    const all = Array.from({ length: 8 }, (_, mask) => asRows(qrCode('https://example.com/orders?id=12345', { mask })!));
    assert.ok(all.some((m) => JSON.stringify(m) === JSON.stringify(best)));
    assert.deepEqual(asRows(qrCode('https://example.com/orders?id=12345')!), best);
  });

  test('too long for any version: none', () => {
    assert.ok(qrCode('x'.repeat(QR_MAX_BYTES)));
    assert.equal(qrCode('x'.repeat(QR_MAX_BYTES + 1)), undefined);
  });
});

describe('Code 128', () => {
  test('every symbol is 11 modules wide with an even total of bar widths (the stop symbol: 13)', () => {
    assert.equal(CODE128_PATTERNS.length, 107);
    CODE128_PATTERNS.forEach((p, v) => {
      const widths = [...p].map(Number);
      assert.equal(widths.reduce((a, b) => a + b, 0), v === 106 ? 13 : 11, `symbol ${v}`);
      assert.equal(widths.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) % 2, 0, `symbol ${v}: bar parity`);
    });
    assert.equal(new Set(CODE128_PATTERNS).size, 107, 'no two alike');
  });

  test('code set B: a start, a symbol per character, the check symbol and the stop', () => {
    // Check: (104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7) mod 103 = 879 mod 103 = 55.
    assert.deepEqual(code128Values('PJJ123C'), [104, 48, 42, 42, 17, 18, 19, 35, 55, 106]);
  });

  test('runs of four or more digits are packed two to a symbol (code set C)', () => {
    const v = code128Values('123456')!;
    assert.deepEqual(v.slice(0, 4), [105, 12, 34, 56], 'starts in C');
    assert.equal(v.length, 6);
    const mixed = code128Values('AB12345678')!;
    assert.deepEqual(mixed.slice(0, 7), [104, 33, 34, 99, 12, 34, 56], 'B, then Code C for the digits');
    const odd = code128Values('12345')!;
    assert.deepEqual(odd.slice(0, 5), [105, 12, 34, 100, 21], 'an odd digit left over goes back to B');
  });

  test('module widths: alternating bar and space, 11 per symbol plus 13 for the stop', () => {
    const widths = code128('HELLO')!;
    assert.equal(widths.length, (code128Values('HELLO')!.length - 1) * 6 + 7);
    assert.equal(widths.reduce((a, b) => a + b, 0), (code128Values('HELLO')!.length - 1) * 11 + 13);
  });

  test('decoding the widths gives back the symbols', () => {
    const text = 'ORD-00012345 / x';
    const widths = code128(text)!;
    const values: number[] = [];
    for (let i = 0; i < widths.length - 7; i += 6) values.push(CODE128_PATTERNS.indexOf(widths.slice(i, i + 6).join('') as never));
    values.push(CODE128_PATTERNS.indexOf(widths.slice(-7).join('') as never));
    assert.deepEqual(values, code128Values(text));
  });

  test('empty text, or characters outside printable ASCII: none', () => {
    assert.equal(code128(''), undefined);
    assert.equal(code128('café'), undefined);
    assert.equal(code128('tab\there'), undefined);
  });
});
