// The new widgets, displays, labels and images in screen definitions: what
// validation accepts and refuses, and the conversions and addresses behind them.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ScreenSnapshot } from '@veneer/terminal';
import {
  THEME_FILE, fillLink, hostToTime, imageSourceKind, imageUrl, readNumber, timeToHost, validateDefinition,
  type Change, type ScreenDefinition,
} from '../src/index.ts';

const def = (changes: unknown[], more: Record<string, unknown> = {}): unknown => ({
  id: 'test', name: 'Test', match: { screenIds: ['0a1b2c3d4e5f60'], text: [] }, changes, ...more,
});
const valid = (...changes: unknown[]): Change[] => validateDefinition(def(changes)).changes;
const refused = (change: unknown, message: RegExp, more?: Record<string, unknown>) =>
  assert.throws(() => validateDefinition(def([change], more)), message);

describe('input widgets', () => {
  test('a switch has on and off values, like a checkbox', () => {
    assert.deepEqual(valid({ op: 'widget', field: '6:20', widget: { type: 'toggle', on: 'Y', off: 'N' } })[0],
      { op: 'widget', field: '6:20', widget: { type: 'toggle', on: 'Y', off: 'N' } });
    refused({ op: 'widget', field: '6:20', widget: { type: 'toggle', on: 'Y' } }, /widget\.off: must be a string/);
  });

  test('a time picker needs one of the host formats', () => {
    for (const format of ['HHMMSS', 'HHMM', 'HH:MM:SS', 'HH:MM', 'HH.MM.SS', 'HH.MM']) {
      assert.deepEqual(valid({ op: 'widget', field: '6:20', widget: { type: 'time', format } })[0], { op: 'widget', field: '6:20', widget: { type: 'time', format } });
    }
    refused({ op: 'widget', field: '6:20', widget: { type: 'time', format: 'hh:mm' } }, /widget\.format: must be one of/);
  });

  test('a mask needs a slot to type into; literals only when true', () => {
    assert.deepEqual(valid({ op: 'widget', field: '6:20', widget: { type: 'mask', mask: '999-99-9999', literals: false } })[0],
      { op: 'widget', field: '6:20', widget: { type: 'mask', mask: '999-99-9999' } }, 'false is left out');
    assert.deepEqual((valid({ op: 'widget', field: '6:20', widget: { type: 'mask', mask: '(999) 999-9999', literals: true } })[0] as { widget: unknown }).widget,
      { type: 'mask', mask: '(999) 999-9999', literals: true });
    refused({ op: 'widget', field: '6:20', widget: { type: 'mask', mask: '---' } }, /needs at least one 9/);
    refused({ op: 'widget', field: '6:20', widget: { type: 'mask', mask: '99', literals: 'yes' } }, /literals: must be true or false/);
  });

  test('a lookup needs suggestions, a prompt key, or both', () => {
    const both = { type: 'lookup', options: [{ value: 'TX', label: 'Texas' }], prompt: { aid: 'F4' } };
    assert.deepEqual((valid({ op: 'widget', field: '6:20', widget: both })[0] as { widget: unknown }).widget, both);
    assert.deepEqual((valid({ op: 'widget', field: '6:20', widget: { type: 'lookup', prompt: { aid: 'F4' } } })[0] as { widget: unknown }).widget,
      { type: 'lookup', prompt: { aid: 'F4' } });
    refused({ op: 'widget', field: '6:20', widget: { type: 'lookup' } }, /needs options, a prompt key, or both/);
    refused({ op: 'widget', field: '6:20', widget: { type: 'lookup', options: [] } }, /needs options, a prompt key, or both/);
    refused({ op: 'widget', field: '6:20', widget: { type: 'lookup', prompt: { aid: 'F99' } } }, /prompt\.aid: must be an AID key/);
  });

  test('a lookup\'s key must exist on the definition\'s host', () => {
    refused({ op: 'widget', field: '6:20', widget: { type: 'lookup', prompt: { aid: 'Help' } } }, /prompt\.aid: Help is not a 3270 key/, { host: '3270' });
    refused({ op: 'widget', field: '6:20', widget: { type: 'lookup', prompt: { aid: 'PA1' } } }, /prompt\.aid: PA1 is not a 5250 key/, { host: '5250' });
    assert.doesNotThrow(() => validateDefinition(def([{ op: 'widget', field: '6:20', widget: { type: 'lookup', prompt: { aid: 'F4' } } }], { host: '5250' })));
  });

  test('an unknown widget type names the ones there are', () => {
    refused({ op: 'widget', field: '6:20', widget: { type: 'slider' } }, /must be select, checkbox, toggle, date, time, radio, spinner, textarea, mask or lookup/);
  });
});

describe('displays (how output text is shown)', () => {
  const display = (d: unknown, where: Record<string, unknown> = { at: { row: 5, col: 10 } }) => valid({ op: 'display', ...where, display: d })[0];

  test('at a position or for a list column, never both or neither', () => {
    assert.deepEqual(display({ type: 'number' }), { op: 'display', at: { row: 5, col: 10 }, display: { type: 'number' } });
    assert.deepEqual(display({ type: 'number' }, { column: 'Amount' }), { op: 'display', column: 'Amount', display: { type: 'number' } });
    refused({ op: 'display', display: { type: 'number' } }, /needs either column or at/);
    refused({ op: 'display', at: { row: 5, col: 10 }, column: 'Amount', display: { type: 'number' } }, /needs either column or at/);
    refused({ op: 'display', column: '  ', display: { type: 'number' } }, /column: must not be blank/);
  });

  test('a badge: values with a style, an optional label, and a style for the others', () => {
    assert.deepEqual(display({ type: 'badge', values: [{ value: 'MSGW', label: 'Waiting', role: 'danger' }, { value: 'RUN', label: '', role: 'accent' }], otherwise: 'muted' }),
      { op: 'display', at: { row: 5, col: 10 }, display: { type: 'badge', values: [{ value: 'MSGW', label: 'Waiting', role: 'danger' }, { value: 'RUN', role: 'accent' }], otherwise: 'muted' } },
      'an empty label is left out');
    refused({ op: 'display', at: { row: 5, col: 10 }, display: { type: 'badge', values: [{ value: 'A', role: 'loud' }] } }, /values\[0\]\.role: must be one of/);
  });

  test('a number: implied and shown decimals 0-9, a currency code', () => {
    assert.deepEqual((display({ type: 'number', implied: 2, decimals: 2, currency: 'USD' }) as { display: unknown }).display,
      { type: 'number', implied: 2, decimals: 2, currency: 'USD' });
    assert.deepEqual((display({ type: 'number', currency: '' }) as { display: unknown }).display, { type: 'number' });
    refused({ op: 'display', at: { row: 1, col: 1 }, display: { type: 'number', implied: 10 } }, /implied: must be an integer 0-9/);
    refused({ op: 'display', at: { row: 1, col: 1 }, display: { type: 'number', currency: 'usd' } }, /currency: must be a currency code/);
  });

  test('a date: a host format and a style', () => {
    assert.deepEqual((display({ type: 'date', format: 'YYYYMMDD', style: 'long' }) as { display: unknown }).display, { type: 'date', format: 'YYYYMMDD', style: 'long' });
    refused({ op: 'display', at: { row: 1, col: 1 }, display: { type: 'date', format: 'YYYYMMDD', style: 'full' } }, /style: must be one of short, medium, long/);
  });

  test('yes or no: the yes value must not be blank', () => {
    assert.deepEqual((display({ type: 'yesno', yes: 'Y', no: '' }) as { display: unknown }).display, { type: 'yesno', yes: 'Y', no: '' });
    refused({ op: 'display', at: { row: 1, col: 1 }, display: { type: 'yesno', yes: ' ', no: 'N' } }, /yes: must not be blank/);
  });

  test('a link: a kind, and an address template for web links only', () => {
    assert.deepEqual((display({ type: 'link', to: 'email' }) as { display: unknown }).display, { type: 'link', to: 'email' });
    assert.deepEqual((display({ type: 'link', to: 'url', url: 'https://crm.example.com/c/{value}?from={6:22}' }) as { display: unknown }).display,
      { type: 'link', to: 'url', url: 'https://crm.example.com/c/{value}?from={6:22}' });
    refused({ op: 'display', at: { row: 1, col: 1 }, display: { type: 'link', to: 'phone', url: 'https://x.example' } }, /url: is only for links to a web address/);
    refused({ op: 'display', at: { row: 1, col: 1 }, display: { type: 'link', to: 'url', url: 'javascript:alert(1)' } }, /must start with http/);
    refused({ op: 'display', at: { row: 1, col: 1 }, display: { type: 'link', to: 'url', url: 'https://{value}/x' } }, /no placeholders in the host/);
  });

  test('a progress bar needs a positive maximum; a barcode a format and 1-20 rows', () => {
    assert.deepEqual((display({ type: 'progress', max: 12.5 }) as { display: unknown }).display, { type: 'progress', max: 12.5 });
    refused({ op: 'display', at: { row: 1, col: 1 }, display: { type: 'progress', max: 0 } }, /max: must be more than 0/);
    assert.deepEqual((display({ type: 'barcode', format: 'code128', height: 2 }) as { display: unknown }).display, { type: 'barcode', format: 'code128', height: 2 });
    refused({ op: 'display', at: { row: 1, col: 1 }, display: { type: 'barcode', format: 'ean13', height: 2 } }, /format: must be one of qr, code128/);
    refused({ op: 'display', at: { row: 1, col: 1 }, display: { type: 'barcode', format: 'qr', height: 21 } }, /height: must be an integer 1-20/);
  });

  test('an unknown display type names the ones there are', () => {
    refused({ op: 'display', at: { row: 1, col: 1 }, display: { type: 'sparkline' } }, /must be badge, number, date, yesno, link, progress or barcode/);
  });
});

describe('labels and images', () => {
  test('a label: text, a style, a color and help, the defaults left out', () => {
    assert.deepEqual(valid({ op: 'label', at: { row: 3, col: 2 }, text: 'Shipping', style: 'heading', role: 'accent', help: 'Where the order goes.' })[0],
      { op: 'label', at: { row: 3, col: 2 }, text: 'Shipping', style: 'heading', role: 'accent', help: 'Where the order goes.' });
    assert.deepEqual(valid({ op: 'label', at: { row: 3, col: 2 }, text: 'Note', help: '' })[0], { op: 'label', at: { row: 3, col: 2 }, text: 'Note' });
    refused({ op: 'label', at: { row: 3, col: 2 }, text: '  ' }, /text: must not be blank/);
    refused({ op: 'label', at: { row: 3, col: 2 }, text: 'x', style: 'title' }, /style: must be one of text, heading, subheading, note/);
    refused({ op: 'label', at: { row: 3, col: 2 }, text: 'x', help: 'h'.repeat(501) }, /help: must be a string of at most 500/);
  });

  test('an image: a theme image, a web address or a site path, with alt text and a size', () => {
    const image = (src: string) => valid({ op: 'image', at: { row: 2, col: 60 }, src, alt: 'Logo', width: 18, height: 4 })[0];
    assert.deepEqual(image('banner.png'), { op: 'image', at: { row: 2, col: 60 }, src: 'banner.png', alt: 'Logo', width: 18, height: 4 });
    assert.ok(image('https://cdn.example.com/items/{6:12}.jpg'));
    assert.ok(image('/images/{6:12}.png'));
    assert.deepEqual(valid({ op: 'image', at: { row: 2, col: 2 }, src: 'logo.svg', width: 4, height: 2, fit: 'cover' })[0],
      { op: 'image', at: { row: 2, col: 2 }, src: 'logo.svg', alt: '', width: 4, height: 2, fit: 'cover' }, 'no alt: a decoration');
    for (const src of ['javascript:alert(1)', '//evil.example/x.png', 'data:image/png;base64,AA', 'logo.exe', '../secret.png', '/a/../b.png']) {
      refused({ op: 'image', at: { row: 2, col: 2 }, src, alt: '', width: 4, height: 2 }, /src: must be an image of the theme|src: must start with http/, );
    }
    refused({ op: 'image', at: { row: 2, col: 2 }, src: '/p/{99:1}.png', alt: '', width: 4, height: 2 }, /\{99:1\} is not a screen position/);
    refused({ op: 'image', at: { row: 2, col: 2 }, src: 'a.png', alt: '', width: 0, height: 2 }, /width: must be an integer 1-132/);
  });

  test('an unknown op names the ones there are', () => {
    refused({ op: 'video' }, /must be hide, text, role, widget, button, move, style, card, tabs, component, html, display, label or image/);
  });

  test('a definition with every new change round-trips through validation', () => {
    const changes = [
      { op: 'widget', field: '4:20', widget: { type: 'toggle', on: 'Y', off: 'N' } },
      { op: 'widget', field: '5:20', widget: { type: 'time', format: 'HHMM' } },
      { op: 'widget', field: '6:20', widget: { type: 'mask', mask: '999-9999' } },
      { op: 'widget', field: '7:20', widget: { type: 'lookup', options: [{ value: 'A', label: 'Air' }] } },
      { op: 'display', column: 'Status', display: { type: 'badge', values: [{ value: 'MSGW', role: 'danger' }] } },
      { op: 'label', at: { row: 3, col: 2 }, text: 'Order' },
      { op: 'image', at: { row: 2, col: 60 }, src: 'logo.png', alt: 'Acme', width: 10, height: 3 },
    ];
    const clean = validateDefinition(def(changes)) as ScreenDefinition;
    assert.deepEqual(validateDefinition(JSON.parse(JSON.stringify(clean))), clean);
  });
});

describe('times', () => {
  test('host times to the browser\'s and back, in each format', () => {
    assert.equal(hostToTime('143005', 'HHMMSS'), '14:30:05');
    assert.equal(hostToTime('1430', 'HHMM'), '14:30');
    assert.equal(hostToTime('14.30.05', 'HH.MM.SS'), '14:30:05');
    assert.equal(hostToTime('09:05', 'HH:MM'), '09:05');
    assert.equal(timeToHost('14:30:05', 'HHMMSS'), '143005');
    assert.equal(timeToHost('14:30', 'HHMMSS'), '143000', 'no seconds picked: 00');
    assert.equal(timeToHost('14:30:05', 'HH.MM'), '14.30', 'seconds dropped where the host has none');
    assert.equal(timeToHost('', 'HHMM'), '', 'cleared stays blank');
  });

  test('blank, the wrong length, separators or out of range: no time', () => {
    assert.equal(hostToTime('', 'HHMM'), '');
    assert.equal(hostToTime('143', 'HHMM'), '');
    assert.equal(hostToTime('14-30', 'HH:MM'), '');
    assert.equal(hostToTime('2460', 'HHMM'), '');
    assert.equal(hostToTime('ab12', 'HHMM'), '');
  });
});

describe('addresses for links and images', () => {
  const snap = { rows: 24, cols: 80, lines: ['', '', '', '', '', '     ITEM-42 / A'], fields: [] } as unknown as ScreenSnapshot;

  test('a link template: {value} is the text, URL-encoded', () => {
    assert.equal(fillLink('https://crm.example.com/c/{value}', ' ACME & Co ', snap), 'https://crm.example.com/c/ACME%20%26%20Co');
    assert.equal(fillLink('https://x.example/?item={6:6}', '', snap), 'https://x.example/?item=ITEM-42%20%2F%20A');
    assert.equal(fillLink('ftp://x.example/{value}', 'a', snap), undefined);
  });

  test('what kind of image source a name is', () => {
    assert.equal(imageSourceKind('banner.png', THEME_FILE), 'theme');
    assert.equal(imageSourceKind('https://cdn.example.com/a.png', THEME_FILE), 'web');
    assert.equal(imageSourceKind('/images/a.png', THEME_FILE), 'site');
    for (const bad of ['//evil.example/a.png', '/\\evil', 'javascript:x', 'a b.png', '/x/../y', '']) assert.equal(imageSourceKind(bad, THEME_FILE), undefined, bad);
  });

  test('an image\'s address: the theme in use, or filled from the screen with each value encoded', () => {
    assert.equal(imageUrl('banner.png', snap, THEME_FILE, '/themes/acme/'), '/themes/acme/banner.png');
    assert.equal(imageUrl('banner.png', snap, THEME_FILE, undefined), undefined, 'no theme: nothing to load');
    assert.equal(imageUrl('/photos/{6:6:7}.jpg', snap, THEME_FILE, undefined), '/photos/ITEM-42.jpg');
    assert.equal(imageUrl('/photos/{6:6}.jpg', snap, THEME_FILE, undefined), '/photos/ITEM-42%20%2F%20A.jpg', 'a value can\'t add a path segment');
    assert.equal(imageUrl('https://cdn.example.com/{6:6:7}.jpg', snap, THEME_FILE, undefined), 'https://cdn.example.com/ITEM-42.jpg');
  });
});

describe('reading numbers', () => {
  test('the value and the decimals the text has', () => {
    assert.deepEqual(readNumber('1,234.50-'), { value: -1234.5, decimals: 2 });
    assert.deepEqual(readNumber('12,5'), { value: 12.5, decimals: 1 });
    assert.deepEqual(readNumber('1250'), { value: 1250, decimals: 0 });
    assert.deepEqual(readNumber('  7 CR'), { value: -7, decimals: 0 });
    assert.equal(readNumber('ABC'), undefined);
  });
});
