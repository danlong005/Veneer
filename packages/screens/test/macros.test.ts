import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ScreenSnapshot } from '@veneer/terminal';
import { Attr, HostStream, Terminal, buildRecord, getCodepage, snapshot } from '@veneer/tn5250';
import {
  DefinitionError, MacroRun, apiValues, fillValue, macroScreens, macroValues, screenId, validateMacro,
  type Macro, type MacroResult,
} from '../src/index.ts';

const cp = getCodepage(37);
const { WHITE } = Attr;

function screen(build: (s: HostStream) => HostStream): ScreenSnapshot {
  const t = new Terminal({ codepage: cp, terminalType: 'IBM-3179-2', sendRecord: () => {} });
  t.processRecord(buildRecord(0x03, build(new HostStream().clear().write()).readMdt().build()));
  return snapshot(t.screen, cp);
}

const signOn = screen((s) => s.text(1, 36, 'Sign On', WHITE).text(6, 17, 'User').field(6, 53, 10).text(7, 17, 'Password').field(7, 53, 10, { attr: Attr.NONDISPLAY }));
const mainMenu = screen((s) => s.text(1, 33, 'IBM i Main Menu', WHITE).text(20, 2, '===>').field(20, 7, 73));
const orderMenu = screen((s) => s.text(1, 34, 'Order Menu', WHITE).text(5, 6, '3. Order inquiry').text(20, 2, '===>').field(20, 7, 73));
const inquiry = screen((s) => s.text(1, 33, 'Order Inquiry', WHITE).text(4, 2, 'Order number').field(4, 30, 9));
const messages = screen((s) => s.text(1, 25, 'Display Program Messages', WHITE).text(3, 2, 'Job 123456/DLONG/QPADEV0001 started.'));
const order = screen((s) => s.text(1, 33, 'Order 12345', WHITE).text(4, 2, 'Customer  Lakeside Hardware'));
const id = screenId;

const MACRO = {
  name: 'order-inquiry',
  label: 'Order inquiry',
  params: { order: { label: 'order number', required: true, pattern: '[0-9]{1,9}' } },
  steps: [
    { screen: id(messages), title: 'Display Program Messages', press: 'Enter', optional: true },
    { screen: id(mainMenu), title: 'IBM i Main Menu', fields: { '20:7': '11' }, press: 'Enter' },
    { screen: id(orderMenu), title: 'Order Menu', fields: { '20:7': '3' }, press: 'Enter' },
    { screen: id(inquiry), title: 'Order Inquiry', fields: { '4:30': '{order}' }, press: 'Enter' },
  ],
};
const macro = validateMacro(MACRO);
const keys = (r: MacroResult) => ('send' in r ? [r.step, r.send.aid, r.send.fields] : r);

test('a macro file: the issue\'s example, and what is refused', () => {
  assert.deepEqual(validateMacro(MACRO), MACRO);
  const bad = (change: Record<string, unknown>, message: RegExp) =>
    assert.throws(() => validateMacro({ ...MACRO, ...change }), (e: Error) => e instanceof DefinitionError && message.test(e.message));
  bad({ name: 'Order Inquiry' }, /^name:/);
  bad({ steps: [] }, /^steps: needs at least one step/);
  bad({ steps: [{ ...MACRO.steps[1], fields: { '20:7': '{customer}' } }] }, /\{customer\} is not one of the macro's parameters/);
  bad({ params: { user: {} } }, /"user" is reserved/);
  bad({ params: { order: { pattern: '[0-9' } } }, /not a valid regular expression/);
  bad({ steps: [{ ...MACRO.steps[1], press: 'F99' }] }, /press: must be a key/);
  bad({ host: '3270', steps: [{ ...MACRO.steps[1], press: 'Help' }] }, /not a key on a mainframe terminal/);
  bad({ steps: [{ ...MACRO.steps[1], fields: { '20-7': 'x' } }] }, /is not a field id/);
  bad({ steps: [{ ...MACRO.steps[1], screen: 'menu' }] }, /must be a screen id/);
  assert.deepEqual(validateMacro({ ...MACRO, steps: [{ ...MACRO.steps[1], fields: { '20:7': '{user}' } }] }).steps[0]!.fields, { '20:7': '{user}' }, '{user} needs no declaring');
});

test('a saved macro reads in order: what it is, its values, then each step\'s screen, typing and key', () => {
  const scrambled = { steps: [{ press: 'Enter', optional: true, fields: { '20:7': '1' }, title: 'Menu', screen: id(mainMenu) }], menu: true, params: { order: {} }, label: 'L', host: '5250', name: 'n' };
  const m = validateMacro(scrambled);
  assert.deepEqual(Object.keys(m), ['name', 'label', 'host', 'params', 'steps', 'menu']);
  assert.deepEqual(Object.keys(m.steps[0]!), ['screen', 'title', 'fields', 'press', 'optional']);
});

test('parameter values: declared ones only, required, matching the whole pattern', () => {
  assert.deepEqual(macroValues(macro, { order: ' 12345 ', evil: 'x' }), { order: '12345' }, 'trimmed; undeclared ignored');
  assert.throws(() => macroValues(macro, {}), /Order inquiry needs order number\./);
  assert.throws(() => macroValues(macro, { order: '12a' }), /“12a” is not a valid order number\./);
  assert.throws(() => macroValues(macro, { order: '1234567890' }), /not a valid order number/, 'the pattern is anchored at both ends');
  assert.throws(() => macroValues(macro, { order: '1'.repeat(300) }), /too long/);
  assert.equal(fillValue('{order}/{user}/{other}', { order: '1', user: 'DLONG' }), '1/DLONG/{other}');
  assert.deepEqual(macroScreens(macro), [id(messages), id(mainMenu), id(orderMenu), id(inquiry)]);
});

test('the macro API: opted in with api, named results in output, and values checked as given', () => {
  const m = validateMacro({ ...MACRO, api: true, output: { customer: '4:12', status: '6:30' } });
  assert.equal(m.api, true);
  assert.deepEqual(m.output, { customer: '4:12', status: '6:30' });
  assert.deepEqual(Object.keys(m).slice(-2), ['api', 'output']);
  assert.equal(validateMacro({ ...MACRO, api: false }).api, undefined, 'off is left out of the file');
  assert.equal(validateMacro({ ...MACRO, output: {} }).output, undefined);
  assert.throws(() => validateMacro({ ...MACRO, api: 'yes' }), /api: must be true or false/);
  assert.throws(() => validateMacro({ ...MACRO, output: { 'the customer': '4:12' } }), /output\.the customer: must be a name/);
  assert.throws(() => validateMacro({ ...MACRO, output: { customer: '4-12' } }), /must be a position such as "12:40"/);

  assert.deepEqual(apiValues(m, { order: 12345 }), { order: '12345' }, 'a number is taken as its digits');
  assert.throws(() => apiValues(m, { order: '1', evil: 'x' }), /“evil” is not one of the macro's values \(order\)/);
  assert.throws(() => apiValues(m, { order: { n: 1 } }), /order number must be text or a number/);
  assert.throws(() => apiValues(m, ['12345']), /must be a JSON object/);
  assert.throws(() => apiValues(m, {}), /needs order number/);
  assert.throws(() => apiValues({ ...m, params: undefined }, { order: '1' }), /it takes none/);
});

test('a run types and presses step by step, skipping an optional screen that does not appear', () => {
  const run = new MacroRun(macro, { order: '12345' }, { start: 'here' });
  assert.deepEqual(keys(run.onScreen(mainMenu)), [2, 'Enter', { '20:7': '11' }], 'starts at the first step whose screen this is');
  assert.deepEqual(keys(run.onScreen({ ...orderMenu, keyboardLocked: true })), { wait: true }, 'the host is still working');
  assert.deepEqual(keys(run.onScreen(orderMenu)), [3, 'Enter', { '20:7': '3' }]);
  assert.deepEqual(keys(run.onScreen(inquiry)), [4, 'Enter', { '4:30': '12345' }]);
  assert.deepEqual(run.onScreen(order), { done: true }, 'the last screen is left for the user');
  assert.deepEqual(run.onScreen(order), { done: true });
});

test('an optional screen that appears is answered; any other screen stops the run', () => {
  const run = new MacroRun(macro, { order: '1' }, { start: 'here' });
  assert.deepEqual(keys(run.onScreen(messages)), [1, 'Enter', {}]);
  assert.deepEqual(keys(run.onScreen(mainMenu)), [2, 'Enter', { '20:7': '11' }]);
  assert.deepEqual(run.onScreen(inquiry), { done: true, error: 'Step 3 expected the “Order Menu” screen.', step: 3 });
});

test('an optional step between two others is skipped when its screen does not come', () => {
  const m = validateMacro({ ...MACRO, steps: [MACRO.steps[1], { ...MACRO.steps[0], optional: true }, MACRO.steps[2]] });
  const skipped = new MacroRun(m, {}, { start: 'here' });
  skipped.onScreen(mainMenu);
  assert.deepEqual(keys(skipped.onScreen(orderMenu)), [3, 'Enter', { '20:7': '3' }]);
  const shown = new MacroRun(m, {}, { start: 'here' });
  shown.onScreen(mainMenu);
  assert.deepEqual(keys(shown.onScreen(messages)), [2, 'Enter', {}]);
  assert.deepEqual(keys(shown.onScreen(orderMenu)), [3, 'Enter', { '20:7': '3' }]);
});

test('a host error after a step stops the run on that screen', () => {
  const run = new MacroRun(macro, { order: '99' }, { start: 'here' });
  run.onScreen(inquiry);
  assert.deepEqual(run.onScreen({ ...inquiry, keyboardLocked: true, error: 'Order 99 not found.  ' }), { done: true, error: 'Step 4: Order 99 not found.', step: 4 },
    'the keyboard stays locked with the error showing');
});

test('from a deep link the run waits through sign-on; from a button it must start here', () => {
  const link = new MacroRun(macro, { order: '1' }, { start: 'link' });
  assert.equal(link.timeoutMs, undefined, 'no time limit while signing on');
  assert.deepEqual(link.onScreen(signOn), { wait: true });
  assert.deepEqual(keys(link.onScreen(mainMenu)), [2, 'Enter', { '20:7': '11' }]);
  assert.equal(link.timeoutMs, 30_000);
  const here = new MacroRun(macro, { order: '1' }, { start: 'here' });
  assert.deepEqual(here.onScreen(signOn), { done: true, error: 'It doesn\'t start from this screen.' });
});

test('values are checked against their fields before the key is pressed', () => {
  const user = validateMacro({ ...MACRO, steps: [{ ...MACRO.steps[3], fields: { '4:30': '{user}' } }] });
  assert.deepEqual(keys(new MacroRun(user, {}, { start: 'here', user: 'DLONG' }).onScreen(inquiry)), [1, 'Enter', { '4:30': 'DLONG' }]);
  const long = validateMacro({ ...MACRO, steps: [{ ...MACRO.steps[3], fields: { '4:30': '1234567890' } }] });
  assert.deepEqual(new MacroRun(long, {}, { start: 'here' }).onScreen(inquiry), { done: true, error: 'Step 1: “1234567890” is too long for the field at 4:30.', step: 1 });
  const checked = new MacroRun(macro, { order: '12' }, { start: 'here', check: (f, v) => (f.id === '4:30' ? `checked ${v}` : undefined) });
  checked.onScreen(mainMenu);
  checked.onScreen(orderMenu);
  assert.deepEqual(checked.onScreen(inquiry), { done: true, error: 'Step 4: checked 12', step: 4 }, 'the browser\'s own field rules');
  const missing = validateMacro({ ...MACRO, steps: [{ ...MACRO.steps[3], fields: { '5:30': 'x' } }] });
  assert.deepEqual(new MacroRun(missing, {}, { start: 'here' }).onScreen(inquiry), { done: true, error: 'Step 1: the field at 5:30 is not on the screen.', step: 1 });
});

test('a run can time out, be cancelled, and only runs on its kind of host', () => {
  const run = new MacroRun(macro, { order: '1' }, { start: 'here' });
  run.onScreen(mainMenu);
  assert.deepEqual(run.timedOut(), { done: true, error: 'Step 3: the screen did not appear in time.', step: 3 });
  assert.deepEqual(new MacroRun(macro, {}, { start: 'here' }).cancel(), { done: true, error: 'Stopped.' });
  const timed: Macro = { ...macro, timeout: 5 };
  assert.equal(new MacroRun(timed, {}, { start: 'here' }).timeoutMs, 5000);
  const mainframe: Macro = { ...macro, host: '3270' };
  assert.deepEqual(new MacroRun(mainframe, {}, { start: 'here' }).onScreen(mainMenu), { done: true, error: 'It is for another kind of host.' });
});
