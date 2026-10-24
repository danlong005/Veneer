import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Attr, HostStream, Terminal, buildRecord, getCodepage, snapshot } from '@veneer/tn5250';
import { hostToIso, isoToHost, matchScreen, validateDefinition, validateSite, type ScreenDefinition } from '../src/index.ts';

const cp = getCodepage(37);
function screen(build: (s: HostStream) => HostStream) {
  const t = new Terminal({ codepage: cp, terminalType: 'IBM-3179-2', sendRecord: () => {} });
  t.processRecord(buildRecord(0x03, build(new HostStream().clear().write()).readMdt().build()));
  return snapshot(t.screen, cp);
}
const orders = screen((s) => s.text(1, 2, 'ORD100').text(1, 34, 'Order Entry', Attr.WHITE).field(6, 22, 6));
const def = (id: string, text: ScreenDefinition['match']['text']): ScreenDefinition =>
  ({ id, name: id, match: { text }, changes: [] });

test('matches text at exact positions and prefers the most specific definition', () => {
  const byTitle = def('by-title', [{ row: 1, col: 34, text: 'Order Entry' }]);
  const byBoth = def('by-both', [{ row: 1, col: 34, text: 'Order Entry' }, { row: 1, col: 2, text: 'ORD100' }]);
  const wrongCol = def('wrong', [{ row: 1, col: 35, text: 'Order Entry' }]);
  assert.equal(matchScreen(orders, [byTitle, wrongCol])?.id, 'by-title');
  assert.equal(matchScreen(orders, [byTitle, byBoth])?.id, 'by-both');
  assert.equal(matchScreen(orders, [wrongCol]), undefined);
  assert.equal(matchScreen(orders, [{ ...byTitle, match: { ...byTitle.match, cols: 132 } }]), undefined);
});

test('validates and cleans definitions', () => {
  const clean = validateDefinition({
    id: 'order-entry', name: 'Order Entry', extra: 'dropped',
    match: { text: [{ row: 1, col: 34, text: 'Order Entry' }] },
    title: 'New order',
    changes: [
      { op: 'hide', at: { row: 3, col: 2 } },
      { op: 'widget', field: '7:22', widget: { type: 'select', options: [{ value: 'TX', label: 'Texas' }] } },
      { op: 'button', label: 'Exit', action: { aid: 'F3' } },
      { op: 'html', at: { row: 5, col: 50 }, html: '<b>Note</b>', width: 20, height: 3, css: 'color: red;', script: '' },
    ],
    css: '.sheet { color: red }',
    scripts: { load: 'veneer.setField("6:53", "X")', show: '' },
  });
  assert.equal(clean.title, 'New order');
  assert.equal(clean.changes.length, 4);
  assert.equal(clean.css, '.sheet { color: red }');
  assert.deepEqual(clean.scripts, { load: 'veneer.setField("6:53", "X")' }, 'empty scripts dropped');
  assert.deepEqual(validateDefinition({ ...clean, scripts: undefined, script: 'old' }).scripts, { show: 'old' }, 'an old `script` runs on show');
  assert.deepEqual(clean.changes[3], { op: 'html', at: { row: 5, col: 50 }, html: '<b>Note</b>', width: 20, height: 3, css: 'color: red;' });
  assert.ok(!('extra' in clean));
});

test('rejects bad definitions with a useful path', () => {
  const base = { id: 'x', name: 'X', match: { text: [{ row: 1, col: 1, text: 'X' }] }, changes: [] };
  const cases: Array<[unknown, RegExp]> = [
    [{ ...base, id: '../etc' }, /id: must be lowercase/],
    [{ ...base, match: { text: [] } }, /match: needs a screen id/],
    [{ ...base, match: { text: [], screenIds: ['not-hex!'] } }, /match\.screenIds\[0\]/],
    [{ ...base, changes: [{ op: 'hide', at: { row: 99, col: 1 } }] }, /changes\[0\]\.at\.row/],
    [{ ...base, changes: [{ op: 'button', label: 'x', action: { aid: 'F99' } }] }, /aid/],
    [{ ...base, changes: [{ op: 'widget', field: '7:22', widget: { type: 'date', format: 'bogus' } }] }, /format/],
    [{ ...base, changes: [{ op: 'explode' }] }, /op/],
    [{ ...base, changes: [{ op: 'move', at: { row: 1, col: 1 }, to: { row: 30, col: 1 } }] }, /changes\[0\]\.to\.row/],
    [{ ...base, changes: [{ op: 'html', at: { row: 1, col: 1 }, html: 'x', width: 0, height: 1 }] }, /changes\[0\]\.width/],
    [{ ...base, scripts: { show: 'x'.repeat(70_000) } }, /scripts\.show: must be a string/],
    [{ ...base, scripts: { click: 'x' } }, /scripts\.click: must be one of load, show/],
  ];
  for (const [input, message] of cases) assert.throws(() => validateDefinition(input), message);
});

test('validates site-wide CSS and JavaScript', () => {
  assert.deepEqual(validateSite({ css: 'body {}', scripts: { screen: 'x' } }), { css: 'body {}', scripts: { load: '', screen: 'x' } });
  assert.throws(() => validateSite({ scripts: { unload: 'x' } }), /scripts\.unload/);
  assert.throws(() => validateSite({ css: 1 }), /css: must be a string/);
});

test('converts host dates to and from ISO', () => {
  assert.equal(hostToIso('20261023', 'YYYYMMDD'), '2026-10-23');
  assert.equal(hostToIso('102326', 'MMDDYY'), '2026-10-23');
  assert.equal(hostToIso('10/23/99', 'MM/DD/YY'), '1999-10-23');
  assert.equal(hostToIso('20260231', 'YYYYMMDD'), '', 'invalid day');
  assert.equal(hostToIso('', 'YYYYMMDD'), '');
  assert.equal(isoToHost('2026-10-23', 'MMDDYY'), '102326');
  assert.equal(isoToHost('2026-10-23', 'DD/MM/YYYY'), '23/10/2026');
  assert.equal(isoToHost('', 'MMDDYY'), '');
});
