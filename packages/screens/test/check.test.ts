import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ScreenSnapshot } from '@veneer/terminal';
import { Attr, HostStream, Terminal, buildRecord, getCodepage, snapshot } from '@veneer/tn5250';
import {
  checkScreens, mismatch, recordScreen, screenId, validateDefinition, validateMacro, validateRecording,
  type CheckFinding, type Recording, type ScreenDefinition,
} from '../src/index.ts';

const cp = getCodepage(37);
const { WHITE } = Attr;

function screen(build: (s: HostStream) => HostStream): ScreenSnapshot {
  const t = new Terminal({ codepage: cp, terminalType: 'IBM-3179-2', sendRecord: () => {} });
  t.processRecord(buildRecord(0x03, build(new HostStream().clear().write()).readMdt().build()));
  return snapshot(t.screen, cp);
}

const inquiry = screen((s) => s.text(1, 33, 'Order Inquiry', WHITE).text(4, 2, 'Order number').field(4, 30, 9, { value: '12345' }).text(6, 2, 'Status').field(6, 30, 1));
// The display file recompiled: the order number field is now 10 long, at column 31.
const inquiry2 = screen((s) => s.text(1, 33, 'Order Inquiry', WHITE).text(4, 2, 'Order number').field(4, 31, 10).text(6, 2, 'Status').field(6, 30, 1));
const menu = screen((s) => s.text(1, 34, 'Order Menu', WHITE).text(20, 2, '===>').field(20, 7, 73));

const rec = (name: string, snap: ScreenSnapshot, definition?: string): Recording =>
  ({ name, ...(definition ? { definition } : {}), screen: recordScreen(snap) });

const def = (changes: unknown[] = [], extra: Record<string, unknown> = {}): ScreenDefinition => validateDefinition({
  id: 'order-inquiry', name: 'Order inquiry', match: { screenIds: [screenId(inquiry)], text: [] }, changes, ...extra,
});

const messages = (f: CheckFinding[]) => f.map((x) => `${x.level} ${x.file}: ${x.message}`);

test('a recording keeps the screen ID and leaves out what was typed', () => {
  const r = recordScreen(inquiry);
  assert.equal(screenId(r), screenId(inquiry));
  assert.equal(r.fields.find((f) => f.id === '4:30')!.value, '');
  assert.ok(!r.lines.join('\n').includes('12345'));
  assert.ok(!JSON.stringify(r).includes('12345'));
  assert.ok(r.lines[3]!.startsWith(' Order number'));
  // It survives a round trip through a file.
  const back = validateRecording(JSON.parse(JSON.stringify({ name: 'x', definition: 'order-inquiry', screen: r })));
  assert.equal(screenId(back.screen), screenId(inquiry));
});

test('validateRecording rejects bad files', () => {
  assert.throws(() => validateRecording({ name: 'Bad Name', screen: recordScreen(menu) }), /name/);
  assert.throws(() => validateRecording({ name: 'ok', screen: { ...recordScreen(menu), host: 'vt100' } }), /host/);
  assert.throws(() => validateRecording({ name: 'ok' }), /screen/);
});

test('a definition that still matches its recorded screen passes', () => {
  const d = def([{ op: 'widget', field: '4:30', widget: { type: 'select', options: [{ value: '1', label: 'One' }] } }, { op: 'hide', at: { row: 6, col: 2 } }]);
  assert.deepEqual(checkScreens({ definitions: [d], macros: [], recordings: [rec('order-inquiry', inquiry, 'order-inquiry')] }), []);
});

test('a recompiled screen is an error that says what changed', () => {
  const f = checkScreens({ definitions: [def()], macros: [], recordings: [rec('order-inquiry', inquiry2, 'order-inquiry')] });
  assert.equal(f.length, 1);
  assert.equal(f[0]!.level, 'error');
  assert.equal(f[0]!.file, 'order-inquiry.json');
  assert.match(f[0]!.message, new RegExp(`screen ID is now ${screenId(inquiry2)} \\(“Order Inquiry”\\), not ${screenId(inquiry)}`));
  assert.match(f[0]!.message, /snapshots\/order-inquiry\.json/);
});

test('mismatch explains text rules and sizes', () => {
  const d = validateDefinition({ id: 'x', name: 'X', match: { text: [{ row: 1, col: 33, text: 'Order Status' }] }, changes: [] });
  assert.match(mismatch(d, inquiry)!, /“Order Status” is not at 1:33 \(“Order Inquir” is\)/);
  const wide = validateDefinition({ id: 'x', name: 'X', match: { rows: 27, cols: 132, text: [{ row: 1, col: 33, text: 'Order' }] }, changes: [] });
  assert.match(mismatch(wide, inquiry)!, /24x80, not 27x132/);
});

test('fields that moved or vanished are errors; empty positions are warnings', () => {
  const d = def([
    { op: 'widget', field: '4:31', widget: { type: 'date', format: 'YYYYMMDD' } },
    { op: 'button', label: 'Find', action: { aid: 'Enter', fields: { '9:9': 'X' } } },
    { op: 'hide', at: { row: 12, col: 5 } },
    { op: 'style', when: { column: 'Quantity', equals: '0' }, role: 'muted', target: 'row' },
  ]);
  const f = messages(checkScreens({ definitions: [d], macros: [], recordings: [rec('order-inquiry', inquiry, 'order-inquiry')] }));
  assert.deepEqual(f, [
    'error order-inquiry.json: The date widget names the input field at 4:31, which isn\'t on the recorded screen.',
    'error order-inquiry.json: The button “Find” names the input field at 9:9, which isn\'t on the recorded screen.',
    'warning order-inquiry.json: A hidden item is at 12:5, where the recorded screen has nothing.',
    'warning order-inquiry.json: A style rule uses the column “Quantity”, whose heading isn\'t on the recorded screen.',
  ]);
});

test('a definition with no recorded screen is a warning; others recorded for it count', () => {
  assert.deepEqual(checkScreens({ definitions: [def()], macros: [], recordings: [] }), []);
  assert.deepEqual(messages(checkScreens({ definitions: [def()], macros: [], recordings: [rec('menu', menu)] })), [
    'warning order-inquiry.json: No recorded screen matches it, so its fields can\'t be checked. Record its screen in the designer.',
  ]);
  // A screen recorded without naming the definition still checks its fields.
  const d = def([{ op: 'widget', field: '4:31', widget: { type: 'date', format: 'YYYYMMDD' } }]);
  assert.match(messages(checkScreens({ definitions: [d], macros: [], recordings: [rec('inquiry', inquiry)] }))[0]!, /error .*4:31/);
});

test('a more specific definition taking over the recorded screen is an error', () => {
  const loose = validateDefinition({ id: 'loose', name: 'Loose', match: { text: [{ row: 1, col: 33, text: 'Order Inquiry' }] }, changes: [] });
  const f = messages(checkScreens({ definitions: [loose, def()], macros: [], recordings: [rec('loose', inquiry, 'loose')] }));
  assert.ok(f.includes('error loose.json: Its recorded screen (snapshots/loose.json) is customized by "order-inquiry" instead, which matches it more closely.'), f.join('\n'));
});

test('macro buttons need the macro and its required values', () => {
  const macro = validateMacro({
    name: 'order-inquiry', label: 'Order inquiry', params: { order: { required: true } },
    steps: [{ screen: screenId(inquiry), fields: { '4:30': '{order}' }, press: 'Enter' }],
  });
  const d = def([
    { op: 'button', label: 'Look up', action: { macro: 'order-inquiry', params: { customer: '{4:30}' } } },
    { op: 'button', label: 'Gone', action: { macro: 'old-macro' } },
  ]);
  const f = messages(checkScreens({ definitions: [d], macros: [macro], recordings: [rec('order-inquiry', inquiry, 'order-inquiry')] }));
  assert.deepEqual(f, [
    'error order-inquiry.json: The button “Look up” gives the macro "order-inquiry" a value for "customer", which isn\'t one of its parameters.',
    'error order-inquiry.json: The button “Look up” doesn\'t give the macro "order-inquiry" its required "order".',
    'error order-inquiry.json: The button “Gone” runs the macro "old-macro", which doesn\'t exist.',
  ]);
});

test('macro steps are checked against recorded screens', () => {
  const macro = validateMacro({
    name: 'order-inquiry', label: 'Order inquiry', params: { order: {} },
    steps: [
      { screen: screenId(menu), title: 'Order Menu', fields: { '20:7': '3' }, press: 'Enter' },
      { screen: screenId(inquiry), title: 'Order Inquiry', fields: { '4:30': '{order}', '6:30': 'XX' }, press: 'Enter' },
    ],
  });
  // Both screens as they were: only the value too long for its field.
  assert.deepEqual(messages(checkScreens({ definitions: [], macros: [macro], recordings: [rec('menu', menu), rec('inquiry', inquiry)] })), [
    'error macros/order-inquiry.json: Step 2 types “XX” into the field at 6:30, which takes 1 characters.',
  ]);
  // The inquiry screen recompiled and recorded again: the step no longer finds it.
  assert.deepEqual(messages(checkScreens({ definitions: [], macros: [macro], recordings: [rec('menu', menu), rec('inquiry', inquiry2)] })), [
    `error macros/order-inquiry.json: Step 2 expects the “Order Inquiry” screen with screen ID ${screenId(inquiry)}, but it is recorded (snapshots/inquiry.json) with ${screenId(inquiry2)}. Record the macro again.`,
  ]);
  // Not recorded: a warning, not a failure.
  const other = rec('other', screen((s) => s.text(1, 30, 'Something Else', WHITE)));
  assert.deepEqual(messages(checkScreens({ definitions: [], macros: [macro], recordings: [other] })), [
    'warning macros/order-inquiry.json: The screens of steps 1, 2 aren\'t recorded, so they can\'t be checked.',
  ]);
});

test('a recording for a definition that is gone is a warning', () => {
  assert.deepEqual(messages(checkScreens({ definitions: [], macros: [], recordings: [rec('old', menu, 'old-screen')] })), [
    'warning snapshots/old.json: It was recorded for the definition "old-screen", which doesn\'t exist.',
  ]);
});

test('the screen a macro must end on is checked like a step\'s', () => {
  const macro = (end: Record<string, unknown>) => validateMacro({ name: 'order-test', label: 'Order test', steps: [{ screen: screenId(menu), title: 'Order Menu', press: 'Enter' }], end });
  const ends = macro({ screen: screenId(inquiry), title: 'Order Inquiry', expect: [{ at: '6:30', equals: 'D' }] });
  assert.deepEqual(checkScreens({ definitions: [], macros: [ends], recordings: [rec('menu', menu), rec('inquiry', inquiry)] }), []);
  assert.deepEqual(messages(checkScreens({ definitions: [], macros: [ends], recordings: [rec('menu', menu), rec('inquiry', inquiry2)] })), [
    `error macros/order-test.json: It must end on the “Order Inquiry” screen with screen ID ${screenId(inquiry)}, but that screen is recorded (snapshots/inquiry.json) with ${screenId(inquiry2)}.`,
  ]);
  assert.deepEqual(messages(checkScreens({ definitions: [], macros: [ends], recordings: [rec('menu', menu)] })), [
    'warning macros/order-test.json: The screen it must end on isn\'t recorded, so it can\'t be checked.',
  ]);
  assert.deepEqual(checkScreens({ definitions: [], macros: [macro({ expect: [{ message: true, equals: '' }] })], recordings: [rec('menu', menu)] }), [], 'checks alone name no screen');
});
