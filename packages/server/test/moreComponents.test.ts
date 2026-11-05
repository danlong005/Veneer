// The ready-made components that don't show a list (dev/components): the
// spool file viewer, barcode scanner, help panel, embedded page and status
// timeline. Their logic; drawing is checked in a browser.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as spool from '../dev/components/spool.js';
import * as scanner from '../dev/components/scanner.js';
import * as help from '../dev/components/help-panel.js';
import * as embed from '../dev/components/embed.js';
import * as timeline from '../dev/components/timeline.js';

/** DSPSPLF, as a 24 × 80 screen shows it. */
const DSPSPLF = [
  '                           Display Spooled File',
  ' File  . . . . . :   QPJOBLOG                        Page/Line   1/1',
  ' Control . . . . .                                   Columns     1 - 78',
  ' Find  . . . . . .',
  ' *...+....1....+....2....+....3....+....4....+....5....+....6....+....7....+...',
  '  5770SS1 V7R5M0  220415           Job Log                    PUB400  11/05/26',
  '   Job name . . . . . . . . . . :   QPADEV0001      User  . . . . . . :   DLONG',
  '',
  '',
  '                                                                      More...',
  ' F3=Exit   F12=Cancel   F19=Left   F20=Right   F24=More keys',
];

describe('spool file viewer', () => {
  test('finds the report between the column ruler and More...', () => {
    assert.deepEqual(spool.regionOf(DSPSPLF, spool.settings({})), { from: 6, to: 9 });
    assert.deepEqual(spool.regionOf(DSPSPLF, spool.settings({ from: 6, to: 7 })), { from: 6, to: 7 });
    assert.match(spool.regionOf(['ISPF BROWSE', 'text'], spool.settings({})).error, /set "from" and "to"/);
    assert.equal(spool.fileName(DSPSPLF), 'QPJOBLOG');
  });

  test('options', () => {
    assert.deepEqual([spool.settings({}).read, spool.settings({}).maxPages], ['auto', 300]);
    assert.match(spool.settings({ from: 0 }).error, /"from" must be a screen row/);
    assert.match(spool.settings({ from: 9, to: 5 }).error, /"to" must not be above "from"/);
    assert.match(spool.settings({ read: 'later' }).error, /"read"/);
  });

  test('the pages as one document: no trailing blanks, no blank lines at the end', () => {
    assert.deepEqual(spool.documentOf([['a  ', ' b'], ['', 'c', '   '], ['  ']]), ['a', ' b', '', 'c']);
  });

  test('search: every match on every line, ignoring case', () => {
    const lines = ['CPF1234 job ended', 'no', 'cpf9999 and CPF0001'];
    assert.deepEqual(spool.findAll(lines, 'cpf'), [{ line: 0, start: 0, end: 3 }, { line: 2, start: 0, end: 3 }, { line: 2, start: 12, end: 15 }]);
    assert.deepEqual(spool.findAll(lines, ''), []);
    assert.deepEqual(spool.findAll(['aaaa'], 'aa'), [{ line: 0, start: 0, end: 2 }, { line: 0, start: 2, end: 4 }], 'not overlapping');
  });

  test('a safe file name', () => {
    assert.equal(spool.downloadName('QPJOBLOG'), 'QPJOBLOG.txt');
    assert.equal(spool.downloadName('../my report?'), '.._my_report.txt');
    assert.equal(spool.downloadName(''), 'spool.txt');
  });
});

describe('barcode scanner', () => {
  test('options', () => {
    assert.deepEqual([scanner.settings({}).enter, scanner.settings({}).beep, scanner.settings({}).camera], [false, true, 'environment']);
    assert.deepEqual(scanner.settings({ formats: ['QR_CODE', 'ean_13'] }).formats, ['qr_code', 'ean_13']);
    assert.match(scanner.settings({ formats: ['qr'] }).error, /"formats" must be a list of/);
    assert.match(scanner.settings({ camera: 'side' }).error, /"camera"/);
  });

  test('says why it can\'t scan: no HTTPS, no camera, no barcode reading', () => {
    const navigator = { mediaDevices: { getUserMedia() {} } };
    assert.match(scanner.canScan({ isSecureContext: false, navigator }).reason, /HTTPS/);
    assert.match(scanner.canScan({ isSecureContext: true, navigator: {} }).reason, /no camera/);
    assert.match(scanner.canScan({ isSecureContext: true, navigator }).reason, /can't read barcodes/);
    assert.deepEqual(scanner.canScan({ isSecureContext: true, navigator, BarcodeDetector: class {} }), { ok: true });
  });

  test('the formats asked for that the browser has; what a scan types', () => {
    assert.deepEqual(scanner.formatsToUse(['qr_code', 'aztec'], ['qr_code', 'code_128', 'unknown']), ['qr_code']);
    assert.deepEqual(scanner.formatsToUse(null, ['qr_code', 'code_128', 'unknown']), ['qr_code', 'code_128']);
    assert.equal(scanner.scannedText(' 0012345\r\n', 5), '00123');
    assert.equal(scanner.scannedText('\u001d01\u001d17', undefined), '0117', 'GS1 separators taken out');
  });
});

describe('help panel', () => {
  test('options', () => {
    assert.match(help.settings({}).error, /Set "markdown"/);
    assert.equal(help.settings({ markdown: ['# Hi', 'there'] }).markdown, '# Hi\nthere');
    assert.deepEqual([help.settings({ markdown: 'x' }).key, help.settings({ markdown: 'x' }).host], ['F1', 'replace']);
    assert.equal(help.settings({ markdown: 'x', key: 'f24' }).key, 'F24');
    assert.match(help.settings({ markdown: 'x', key: 'Ctrl+H' }).error, /"key"/);
    assert.match(help.settings({ markdown: 'x', host: 'both' }).error, /"host"/);
  });

  test('blocks: headings, paragraphs, lists, code and quotes', () => {
    const md = '# Orders\n\nPick an order\nto see it.\n\n- **2** changes it\n- *5* shows it\n  in full\n\n1. one\n2. two\n\n```\nF4=Prompt\n```\n> Note';
    const b = help.blocks(md);
    assert.deepEqual(b.map((x: Record<string, unknown>) => Object.keys(x)[0]), ['h', 'p', 'ul', 'ol', 'pre', 'quote']);
    assert.deepEqual(b[1].text, ['Pick an order to see it.']);
    assert.deepEqual(b[2].items[0], [{ strong: ['2'] }, ' changes it']);
    assert.deepEqual(b[2].items[1], [{ em: ['5'] }, ' shows it in full'], 'an indented line carries on the item');
    assert.equal(b[4].pre, 'F4=Prompt');
  });

  test('links only to http(s) and mailto; HTML stays text', () => {
    assert.deepEqual(help.inline('[docs](https://example.com/a) and `<b>`'), [{ link: ['docs'], href: 'https://example.com/a' }, ' and ', { code: '<b>' }]);
    const script = help.inline('[x](javascript:alert(1))');
    assert.ok(script.every((p: unknown) => typeof p === 'string'), 'no link');
    assert.equal(script.join(''), '[x](javascript:alert(1))', 'the text as written');
    assert.deepEqual(help.inline('[x](/relative)'), ['[x](/relative)']);
    assert.equal(help.safeHref('mailto:help@example.com'), 'mailto:help@example.com');
    assert.deepEqual(help.blocks('<script>alert(1)</script>')[0].text, ['<script>alert(1)</script>'], 'just text');
  });
});

describe('embedded page', () => {
  const ctx = {
    screen: {
      lines: ['', '', '', ' Order . . :  1234567   Customer . . :  ACME CO'],
      fields: [{ id: '6:20', row: 6, col: 20, length: 10, value: 'AB 12     ' }],
    },
    getField: (id: string) => (id === '6:20' ? 'XY 9' : undefined),
  };

  test('options: an https address is required', () => {
    assert.match(embed.settings({}).error, /Set "url"/);
    assert.match(embed.settings({ url: 'http://example.com/{4:15}' }).error, /https/);
    assert.equal(embed.settings({ url: 'http://localhost:3000/{4:15}' }).error, '');
    assert.match(embed.settings({ url: 'javascript:alert(1)' }).error, /https/);
    assert.match(embed.settings({ url: 'https://x', sandbox: 'allow-scripts"><b' }).error, /sandbox/);
  });

  test('the address filled from the screen: fields as typed, text to a double space, URL-encoded', () => {
    assert.deepEqual(embed.fillUrl(ctx, 'https://docs.example.com/orders/{4:15}?c={4:41}&p={6:20}'), { url: 'https://docs.example.com/orders/1234567?c=ACME%20CO&p=XY%209' });
    assert.deepEqual(embed.fillUrl(ctx, 'https://x/{4:15:3}'), { url: 'https://x/123' });
    assert.deepEqual(embed.fillUrl(ctx, 'https://x/{9:1}'), { blank: '9:1' }, 'waits for a blank value');
  });
});

describe('status timeline', () => {
  const steps = ['ORD', { value: 'PCK', label: 'Picked' }, { value: ['SHP', 'INT'], label: 'Shipped' }, 'DLV'];
  test('options', () => {
    assert.match(timeline.settings({}).error, /Set "steps"/);
    assert.match(timeline.settings({ steps, at: 'row 6' }).error, /"at" must be a position/);
    assert.match(timeline.settings({ steps: [1, 2] }).error, /"steps" must be a list/);
    assert.deepEqual(timeline.settings({ steps, at: '6:20:3' }).at, { row: 6, col: 20, length: 3 });
  });

  test('the status from the bound field, or the screen at "at"', () => {
    const s = timeline.settings({ steps, at: '4:10:3' });
    assert.equal(timeline.statusOf({ field: { id: '4:10' }, value: ' shp ' }, s), 'shp');
    assert.equal(timeline.statusOf({ screen: { lines: ['', '', '', 'Status:  PCKX'], fields: [] } }, s), 'PCK');
  });

  test('where the status is: a step, a stop after a step, or none', () => {
    const s = timeline.settings({ steps, stopped: [{ value: 'CAN', label: 'Cancelled', after: 'PCK' }, 'HLD'] });
    assert.deepEqual(timeline.progressOf(s, 'int'), { current: 2 }, 'any of a step\'s values, ignoring case');
    const can = timeline.progressOf(s, 'CAN');
    assert.deepEqual([can.stopped.label, can.reached], ['Cancelled', 1]);
    assert.equal(timeline.progressOf(s, 'HLD').reached, -1);
    assert.deepEqual(timeline.progressOf(s, 'XYZ'), { unknown: 'XYZ' });
  });
});
