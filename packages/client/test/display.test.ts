// Output text shown differently (display changes), and labels and images:
// what each display makes of the host's text, how a definition applies them
// to a screen, and the designer's helpers for them.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { validateDefinition, type Change, type Display, type ScreenDefinition } from '@veneer/screens';
import { Attr } from '@veneer/tn5250';
import { describeChange } from '../src/designer/changes.ts';
import { defaultDisplay } from '../src/designer/defaults.ts';
import { displayOf, imageAt, labelAt, labelsOf, resolveSelection, setDisplay, setPlaced } from '../src/designer/edit.ts';
import { customize, heightOf, isBox } from '../src/transform/customize.ts';
import { transform, type Item, type TableItem, type TextItem } from '../src/transform/index.ts';
import { badgeOf, displayHeight, displayText, formatDate, formatNumber, linkHref, progressOf, yesNoOf } from '../src/ui/display.ts';
import { layoutOf } from '../src/ui/layout.ts';
import { render, workWithJobs } from './screens.ts';

/** An order's details, as output text: what the display changes work on. */
const orderStatus = () => render((s) => s
  .text(1, 33, 'Order Status', Attr.WHITE)
  .text(4, 3, 'Status').text(4, 20, 'MSGW')
  .text(5, 3, 'Total').text(5, 20, '1234567')
  .text(6, 3, 'Shipped').text(6, 20, '20260304')
  .text(7, 3, 'Email').text(7, 20, 'pat@example.com')
  .text(8, 3, 'Packed').text(8, 20, '75')
  .text(9, 3, 'Tracking').text(9, 20, 'ORD-12345')
  .text(14, 3, 'Notes'));

const definition = (changes: Change[]): ScreenDefinition =>
  validateDefinition({ id: 'test', name: 'Test', match: { screenIds: ['0a1b2c3d4e5f60'], text: [] }, changes });
const textAt = (items: Item[], row: number, col: number) => items.find((i): i is TextItem => i.kind === 'text' && i.row === row && i.col === col);
const tableOf = (items: Item[]) => items.find((i): i is TableItem => i.kind === 'table')!;
const snap = orderStatus();

// ---- what each display shows -------------------------------------------------

describe('status badge', () => {
  const d: Extract<Display, { type: 'badge' }> = {
    type: 'badge', values: [{ value: 'MSGW', label: 'Waiting for reply', role: 'danger' }, { value: 'run', role: 'accent' }], otherwise: 'muted',
  };
  test('a known value shows its label and color, matched ignoring case and blanks', () => {
    assert.deepEqual(badgeOf(' MSGW ', d), { label: 'Waiting for reply', role: 'danger', known: true });
    assert.deepEqual(badgeOf('RUN', d), { label: 'RUN', role: 'accent', known: true }, 'no label: the value');
  });
  test('another value shows as it is, in the style for others; blank shows nothing', () => {
    assert.deepEqual(badgeOf('DEQW', d), { label: 'DEQW', role: 'muted', known: false });
    assert.deepEqual(badgeOf('DEQW', { type: 'badge', values: [] }), { label: 'DEQW', role: 'normal', known: false });
    assert.equal(badgeOf('   ', d), undefined);
  });
});

describe('number', () => {
  test('thousands separators and the decimals sent, in the user\'s format', () => {
    assert.equal(formatNumber('1234567', { type: 'number' }, 'en-US'), '1,234,567');
    assert.equal(formatNumber('1234.50', { type: 'number' }, 'en-US'), '1,234.50', 'trailing zero kept');
    assert.equal(formatNumber('1234.50', { type: 'number' }, 'de-DE'), '1.234,50');
  });
  test('the host\'s negatives: a trailing minus or CR', () => {
    assert.equal(formatNumber('12.50-', { type: 'number' }, 'en-US'), '-12.50');
    assert.equal(formatNumber('7 CR', { type: 'number' }, 'en-US'), '-7');
  });
  test('implied decimals only for text without a decimal point', () => {
    assert.equal(formatNumber('1250', { type: 'number', implied: 2 }, 'en-US'), '12.50');
    assert.equal(formatNumber('1250-', { type: 'number', implied: 2 }, 'en-US'), '-12.50');
    assert.equal(formatNumber('12.5', { type: 'number', implied: 2 }, 'en-US'), '12.5', 'a point: as sent');
  });
  test('fixed decimals and a currency', () => {
    assert.equal(formatNumber('3', { type: 'number', decimals: 2 }, 'en-US'), '3.00');
    assert.equal(formatNumber('1234567', { type: 'number', implied: 2, currency: 'USD' }, 'en-US'), '$12,345.67');
    assert.equal(formatNumber('1234567', { type: 'number', implied: 2, currency: 'EUR' }, 'de-DE'), '12.345,67\u00a0€', 'a no-break space before the sign');
    assert.equal(formatNumber('0-', { type: 'number' }, 'en-US'), '0', 'no minus zero');
  });
  test('not a number: none (the text shows as it is)', () => {
    assert.equal(formatNumber('N/A', { type: 'number' }, 'en-US'), undefined);
    assert.equal(formatNumber('', { type: 'number' }, 'en-US'), undefined);
  });
});

describe('date', () => {
  test('a host date in the user\'s way, in each style', () => {
    assert.equal(formatDate('20260304', { type: 'date', format: 'YYYYMMDD' }, 'en-US'), 'Mar 4, 2026');
    assert.equal(formatDate('030426', { type: 'date', format: 'MMDDYY', style: 'long' }, 'en-US'), 'March 4, 2026');
    assert.equal(formatDate('04/03/2026', { type: 'date', format: 'DD/MM/YYYY', style: 'short' }, 'en-GB'), '04/03/2026');
  });
  test('not a date in the format: none', () => {
    assert.equal(formatDate('20261340', { type: 'date', format: 'YYYYMMDD' }, 'en-US'), undefined);
    assert.equal(formatDate('00000000', { type: 'date', format: 'YYYYMMDD' }, 'en-US'), undefined);
    assert.equal(formatDate('', { type: 'date', format: 'YYYYMMDD' }, 'en-US'), undefined);
  });
});

describe('yes or no, links and progress', () => {
  test('yes or no, ignoring case and blanks; anything else is neither', () => {
    const d = { type: 'yesno', yes: 'Y', no: 'N' } as const;
    assert.equal(yesNoOf('y', d), 'yes');
    assert.equal(yesNoOf(' N ', d), 'no');
    assert.equal(yesNoOf('X', d), undefined);
    assert.equal(yesNoOf('', { type: 'yesno', yes: '1', no: '' }), 'no', 'blank can mean no');
  });

  test('email and phone links', () => {
    assert.equal(linkHref(' pat@example.com ', { type: 'link', to: 'email' }, snap), 'mailto:pat@example.com');
    assert.equal(linkHref('not an address', { type: 'link', to: 'email' }, snap), undefined);
    assert.equal(linkHref('(555) 123-4567', { type: 'link', to: 'phone' }, snap), 'tel:5551234567');
    assert.equal(linkHref('+44 20 7946 0958', { type: 'link', to: 'phone' }, snap), 'tel:+442079460958');
    assert.equal(linkHref('call me', { type: 'link', to: 'phone' }, snap), undefined);
  });

  test('web links: the text itself, or a template', () => {
    assert.equal(linkHref('https://example.com/a', { type: 'link', to: 'url' }, snap), 'https://example.com/a');
    assert.equal(linkHref('example.com', { type: 'link', to: 'url' }, snap), undefined, 'no scheme: not an address');
    assert.equal(linkHref('javascript:alert(1)', { type: 'link', to: 'url' }, snap), undefined);
    assert.equal(linkHref('ORD-12345', { type: 'link', to: 'url', url: 'https://track.example.com/{value}?by={4:20}' }, snap),
      'https://track.example.com/ORD-12345?by=MSGW');
  });

  test('a progress bar: the share of the maximum, kept between empty and full', () => {
    assert.deepEqual(progressOf('75', { type: 'progress', max: 100 }), { value: 75, fraction: 0.75 });
    assert.deepEqual(progressOf('150', { type: 'progress', max: 100 }), { value: 150, fraction: 1 });
    assert.deepEqual(progressOf('5-', { type: 'progress', max: 100 }), { value: -5, fraction: 0 });
    assert.equal(progressOf('n/a', { type: 'progress', max: 100 }), undefined);
  });

  test('the text a display reads as, and the rows it takes', () => {
    assert.equal(displayText('Y', { type: 'yesno', yes: 'Y', no: 'N' }), 'Yes');
    assert.equal(displayText('MSGW', { type: 'badge', values: [{ value: 'MSGW', label: 'Waiting', role: 'danger' }] }), 'Waiting');
    assert.equal(displayText(' abc ', { type: 'number' }), 'abc');
    assert.equal(displayHeight({ type: 'barcode', format: 'qr', height: 5 }), 5);
    assert.equal(displayHeight({ type: 'number' }), 1);
  });
});

// ---- applying them to a screen ---------------------------------------------

describe('display changes on a screen', () => {
  test('text at a position gets its display; the text itself is unchanged', () => {
    const d: Display = { type: 'badge', values: [{ value: 'MSGW', role: 'danger' }] };
    const view = customize(transform(snap), definition([{ op: 'display', at: { row: 4, col: 20 }, display: d }]));
    const item = textAt(view.items, 4, 20)!;
    assert.deepEqual(item.display, d);
    assert.equal(item.text, 'MSGW');
    assert.equal(textAt(view.items, 4, 3)?.display, undefined, 'the label next to it is left alone');
  });

  test('a position with no text, or an input field, changes nothing', () => {
    const view = customize(transform(snap), definition([{ op: 'display', at: { row: 20, col: 20 }, display: { type: 'number' } }]));
    assert.ok(view.items.every((i) => i.kind !== 'text' || !i.display));
  });

  test('a list column: every row\'s cell, found by heading ignoring case; option fields keep theirs', () => {
    const d: Display = { type: 'badge', values: [{ value: 'RUN', role: 'accent' }] };
    const view = customize(transform(workWithJobs()), definition([
      { op: 'display', column: ' status ', display: d },
      { op: 'display', column: 'Opt', display: { type: 'number' } },
    ]));
    const table = tableOf(view.items);
    const k = table.columns.findIndex((c) => c.header.trim() === 'Status');
    assert.ok(k >= 0);
    for (const r of table.rows) assert.deepEqual(r.cells[k]!.display, d);
    const opt = table.columns.findIndex((c) => c.header.trim() === 'Opt');
    for (const r of table.rows) assert.equal(r.cells[opt]!.display, undefined, 'a cell with an input field');
  });

  test('a barcode covers its rows, and the page is tall enough for it', () => {
    const view = customize(transform(snap), definition([{ op: 'display', at: { row: 9, col: 20 }, display: { type: 'barcode', format: 'qr', height: 6 } }]));
    assert.equal(heightOf(textAt(view.items, 9, 20)!), 6);
    const just = { ...view, items: view.items.filter((i) => i.row === 9) };
    assert.equal(layoutOf(just).bottom, 14);
  });

  test('a moved item keeps its display', () => {
    const view = customize(transform(snap), definition([
      { op: 'display', at: { row: 8, col: 20 }, display: { type: 'progress', max: 100 } },
      { op: 'move', at: { row: 8, col: 20 }, to: { row: 8, col: 40 } },
    ]));
    const moved = textAt(view.items, 8, 40)!;
    assert.deepEqual(moved.display, { type: 'progress', max: 100 });
    assert.deepEqual(moved.home, { row: 8, col: 20 });
  });
});

describe('labels and images on a screen', () => {
  test('a label is an item of its own, in reading order, with its defaults', () => {
    const view = customize(transform(snap), definition([
      { op: 'label', at: { row: 3, col: 3 }, text: 'Order details', style: 'heading' },
      { op: 'label', at: { row: 10, col: 3 }, text: 'Questions?', help: 'Call the order desk on 555-0100.' },
    ]));
    const labels = view.items.filter((i) => i.kind === 'label');
    assert.deepEqual(labels.map((l) => [l.row, l.col]), [[3, 3], [10, 3]]);
    assert.deepEqual(labels[0], { kind: 'label', row: 3, col: 3, width: 13, text: 'Order details', style: 'heading', role: 'normal' });
    assert.equal(labels[1]!.kind === 'label' && labels[1]!.help, 'Call the order desk on 555-0100.');
    assert.equal(labels[1]!.width, 12, 'room for the ⓘ');
    const k = view.items.indexOf(labels[1]!);
    assert.ok(view.items.slice(0, k).every((i) => i.row <= 10) && view.items.slice(k + 1).every((i) => i.row >= 10), 'between the items around it');
  });

  test('an image: a theme image from the theme in use, a filled address, or none to load', () => {
    const view = customize(transform(snap), definition([
      { op: 'image', at: { row: 2, col: 60 }, src: 'logo.png', alt: 'Acme', width: 12, height: 3 },
      { op: 'image', at: { row: 10, col: 60 }, src: '/photos/{9:20}.jpg', alt: '', width: 10, height: 4, fit: 'cover' },
    ]), { themeBase: '/themes/acme/' });
    const images = view.items.filter((i) => i.kind === 'image');
    assert.deepEqual(images[0], { kind: 'image', row: 2, col: 60, width: 12, height: 3, src: '/themes/acme/logo.png', alt: 'Acme', fit: 'contain' });
    assert.equal(images[1]!.kind === 'image' && images[1]!.src, '/photos/ORD-12345.jpg');
    assert.equal(heightOf(images[1]!), 4);
    const noTheme = customize(transform(snap), definition([{ op: 'image', at: { row: 2, col: 60 }, src: 'logo.png', alt: 'Acme', width: 12, height: 3 }]));
    assert.equal(noTheme.items.find((i) => i.kind === 'image')!.kind === 'image' && (noTheme.items.find((i) => i.kind === 'image') as { src?: string }).src, undefined);
  });

  test('labels and images are the definition\'s own: hide and text changes and moves leave them alone', () => {
    const view = customize(transform(snap), definition([
      { op: 'label', at: { row: 4, col: 40 }, text: 'Mine' },
      { op: 'hide', at: { row: 4, col: 40 } },
      { op: 'text', at: { row: 4, col: 40 }, text: 'Changed' },
      { op: 'move', at: { row: 4, col: 40 }, to: { row: 5, col: 40 } },
    ]));
    const label = view.items.find((i) => i.kind === 'label')!;
    assert.ok(isBox(label));
    assert.equal(label.kind === 'label' && label.text, 'Mine');
    assert.deepEqual([label.row, label.col, label.hidden], [4, 40, undefined]);
  });

  test('in the designer, clicking one selects it (over the text under it)', () => {
    const view = customize(transform(snap), definition([{ op: 'image', at: { row: 4, col: 18 }, src: 'logo.png', alt: '', width: 8, height: 2 }]), { design: true });
    const picked = resolveSelection(view, snap, { row: 4, col: 20 });
    assert.equal(picked?.kind === 'item' && picked.item.kind, 'image');
    assert.deepEqual(picked?.at, { row: 4, col: 18 });
  });
});

// ---- the designer ------------------------------------------------------------

describe('designer: displays, labels and images', () => {
  const empty = definition([]);

  test('set, change and remove a display, at a position or for a column', () => {
    let d = setDisplay(empty, { at: { row: 4, col: 20 } }, { type: 'number' });
    d = setDisplay(d, { column: 'Status' }, { type: 'yesno', yes: 'Y', no: 'N' });
    assert.deepEqual(displayOf(d, { at: { row: 4, col: 20 } }), { type: 'number' });
    assert.deepEqual(displayOf(d, { column: 'STATUS' }), { type: 'yesno', yes: 'Y', no: 'N' }, 'columns ignore case');
    d = setDisplay(d, { at: { row: 4, col: 20 } }, { type: 'number', decimals: 2 });
    assert.equal(d.changes.filter((c) => c.op === 'display').length, 2, 'replaced, not added');
    d = setDisplay(d, { column: 'status' }, null);
    assert.equal(displayOf(d, { column: 'Status' }), undefined);
    assert.doesNotThrow(() => validateDefinition(d));
  });

  test('add, move and remove labels and images', () => {
    let d = setPlaced(empty, { row: 3, col: 3 }, { at: { row: 3, col: 3 }, text: 'Heading', style: 'heading' });
    d = setPlaced(d, { row: 2, col: 60 }, { at: { row: 2, col: 60 }, src: 'logo.png', alt: 'Acme', width: 10, height: 3 });
    assert.deepEqual(labelAt(d, { row: 3, col: 3 }), { at: { row: 3, col: 3 }, text: 'Heading', style: 'heading' });
    assert.equal(imageAt(d, { row: 2, col: 60 })?.src, 'logo.png');
    assert.equal(labelAt(d, { row: 2, col: 60 }), undefined, 'an image is not a label');
    d = setPlaced(d, { row: 3, col: 3 }, { ...labelAt(d, { row: 3, col: 3 })!, at: { row: 4, col: 3 } });
    assert.deepEqual(labelsOf(d).map((c) => [c.op, c.at.row]), [['label', 4], ['image', 2]], 'moved in place');
    d = setPlaced(d, { row: 2, col: 60 }, null);
    assert.deepEqual(labelsOf(d).map((c) => c.op), ['label']);
    assert.doesNotThrow(() => validateDefinition(d));
  });

  test('a new display starts from the text where that helps', () => {
    assert.deepEqual(defaultDisplay('badge', ' MSGW '), { type: 'badge', values: [{ value: 'MSGW', role: 'accent' }] });
    assert.deepEqual(defaultDisplay('link', 'pat@example.com'), { type: 'link', to: 'email' });
    assert.deepEqual(defaultDisplay('link', '(555) 123-4567'), { type: 'link', to: 'phone' });
    assert.deepEqual(defaultDisplay('date', '030426'), { type: 'date', format: 'MMDDYY' });
    assert.equal(defaultDisplay('text', 'x'), null);
    for (const type of ['badge', 'number', 'date', 'yesno', 'link', 'progress', 'barcode']) {
      assert.doesNotThrow(() => definition([{ op: 'display', at: { row: 1, col: 1 }, display: defaultDisplay(type, 'X')! }]), type);
    }
  });

  test('the Changes list says what each one is', () => {
    const view = transform(snap);
    const line = (c: Change) => describeChange(c, view, snap).label;
    assert.match(line({ op: 'display', at: { row: 4, col: 20 }, display: { type: 'badge', values: [] } }), /^Show .* as a status badge$/);
    assert.equal(line({ op: 'display', column: 'Status', display: { type: 'barcode', format: 'qr', height: 3 } }), 'Show column “Status” as a QR code');
    assert.equal(line({ op: 'label', at: { row: 3, col: 3 }, text: 'Order details' }), 'Label “Order details”');
    assert.equal(line({ op: 'image', at: { row: 2, col: 60 }, src: 'logo.png', alt: 'Acme', width: 4, height: 2 }), 'Image “Acme”');
    assert.equal(line({ op: 'image', at: { row: 2, col: 60 }, src: 'logo.png', alt: '', width: 4, height: 2 }), 'Image logo.png');
  });
});
