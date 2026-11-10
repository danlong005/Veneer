import assert from 'node:assert/strict';
import { test } from 'node:test';
import { screenId, validateMacro, type Macro } from '@veneer/screens';
import {
  addOutput, setOutput,
  checkAt, checksOf, endAnywhere, endHere, messageCheck, setChecks, setTest, testOf,
  deepLink, linkedMacro, macroFieldCheck, makeParameter, moveStep, nameFor, newMacro, paramNameProblem, recordStep,
  removeParameter, removeStep, setStep, unusedParams,
} from '../src/macros/edit.ts';
import { mainMenu, orderEntry, signOn } from './screens.ts';

test('recording a step: the screen, the fields the user changed, the key, and a cursor the user moved', () => {
  const menu = mainMenu();
  const step = recordStep(menu, 'IBM i Main Menu', 'Enter', { '20:7': '11' }, menu.cursor);
  assert.deepEqual(step, { screen: screenId(menu), title: 'IBM i Main Menu', fields: { '20:7': '11' }, press: 'Enter' });
  assert.equal(recordStep(menu, undefined, 'Enter', { '20:7': '11' }, { row: 20, col: 9 }).cursor, undefined, 'Enter: the caret is just where the typing ended');
  assert.equal(recordStep(menu, undefined, 'Enter', {}, { row: 20, col: 7 }).cursor, undefined, 'Enter in the field the host put the cursor in');
  assert.deepEqual(recordStep(menu, undefined, 'Enter', {}, { row: 5, col: 6 }).cursor, { row: 5, col: 6 }, 'Enter with the cursor put somewhere: kept');
  const moved = recordStep(menu, undefined, 'F4', {}, { row: 20, col: 9 });
  assert.deepEqual(moved, { screen: screenId(menu), cursor: { row: 20, col: 9 }, press: 'F4' }, 'F4 prompts depend on the cursor');
  assert.deepEqual(validateMacro({ name: 'm', label: 'M', steps: [step, moved] }).steps, [step, moved], 'recorded steps are valid as they are');
});

test('passwords are never recorded', () => {
  const s = signOn();
  const step = recordStep(s, 'Sign On', 'Enter', { '6:53': 'DLONG', '7:53': 'secret' }, s.cursor);
  assert.deepEqual(step.fields, { '6:53': 'DLONG' });
  assert.ok(!JSON.stringify(step).includes('secret'));
});

const recorded: Macro = newMacro([
  { screen: 'a1a1a1a1a1a1a1', title: 'Main Menu', fields: { '20:7': '11' }, press: 'Enter' },
  { screen: 'b2b2b2b2b2b2b2', title: 'Order Inquiry', fields: { '4:30': '12345', '5:30': '12345' }, press: 'Enter' },
], '5250', ['macro-1']);

test('a recorded macro gets a free name; labels make file names', () => {
  assert.deepEqual([recorded.name, recorded.label, recorded.host], ['macro-2', 'Macro 2', '5250']);
  assert.equal(nameFor('Order inquiry (by number)!'), 'order-inquiry-by-number');
  assert.equal(nameFor('***'), 'macro');
});

test('a typed value becomes a parameter, and can be put back', () => {
  const m = makeParameter(recorded, 1, '4:30', 'order');
  assert.deepEqual(m.steps[1]!.fields, { '4:30': '{order}', '5:30': '12345' }, 'only that field');
  assert.deepEqual(m.params, { order: { required: true } });
  assert.doesNotThrow(() => validateMacro(m));
  assert.deepEqual(unusedParams(m), []);
  assert.deepEqual(unusedParams({ ...m, steps: [m.steps[0]!] }), ['order']);
  const back = removeParameter(m, 'order', '777');
  assert.deepEqual(back.steps[1]!.fields, { '4:30': '777', '5:30': '12345' });
  assert.equal(back.params, undefined);
  assert.equal(paramNameProblem(m, 'order'), 'There is already a parameter called order.');
  assert.equal(paramNameProblem(m, 'user'), '“user” is reserved.');
  assert.match(paramNameProblem(m, '2nd')!, /starting with a letter/);
  assert.equal(paramNameProblem(m, 'customer'), undefined);
});

test('steps can be changed, reordered and removed', () => {
  const [a, b] = recorded.steps;
  assert.deepEqual(moveStep(recorded, 1, -1).steps, [b, a]);
  assert.equal(moveStep(recorded, 0, -1), recorded, 'the first step stays first');
  assert.deepEqual(removeStep(recorded, 0).steps, [b]);
  assert.deepEqual(setStep(recorded, 0, { ...a!, optional: true }).steps[0], { ...a, optional: true });
});

test('deep links name the macro and its values, and are read back from the address', () => {
  const m = makeParameter(recorded, 1, '4:30', 'order');
  const link = deepLink(m, 'https://veneer.example.com', { order: '12 34&x' });
  assert.equal(link, 'https://veneer.example.com/?macro=macro-2&order=12+34%26x');
  assert.deepEqual(linkedMacro(new URL(link).search), { name: 'macro-2', given: { order: '12 34&x' } });
  assert.equal(linkedMacro('?new-session'), null);
});

test('a macro types only what a user could: letters are refused in numeric fields', () => {
  const s = orderEntry();
  const quantity = s.fields.find((f) => f.id === '6:20')!;
  assert.equal(macroFieldCheck(quantity, '12'), undefined);
  assert.equal(macroFieldCheck(quantity, '1A'), '“1A” can\'t be typed into the field at 6:20.');
});

test('the macro API\'s named values: added at the cursor, renamed in place, removed', () => {
  const base = validateMacro({ name: 'm', label: 'M', api: true, steps: [{ screen: screenId(mainMenu()), press: 'Enter' }] });
  let m = addOutput(base, '6:22');
  m = addOutput(m, '7:22');
  assert.deepEqual(m.output, { value1: '6:22', value2: '7:22' });
  m = setOutput(m, 0, 'customer', '6:22');
  assert.deepEqual(Object.entries(m.output!), [['customer', '6:22'], ['value2', '7:22']], 'renaming keeps the order');
  assert.equal(setOutput(m, 1, 'customer', '7:22'), m, 'another value\'s name is refused rather than merging the two');
  m = setOutput(m, 0, null, '');
  assert.deepEqual(m.output, { value2: '7:22' });
  assert.equal('output' in setOutput(m, 0, null, ''), false, 'the last one gone, output goes');
  assert.deepEqual(validateMacro(addOutput(base, '6:22')).output, { value1: '6:22' });
});

// ---- checks, as the Macros panel adds and edits them

test('a check picked on the screen tests what is there now, named by the label before it', () => {
  const menu = mainMenu();
  assert.deepEqual(checkAt(menu, { row: 1, col: 74 }), { at: '1:74', equals: 'PUB400', label: 'System' });
  assert.deepEqual(checkAt(menu, { row: 20, col: 7 }), { at: '20:7', equals: '' }, 'a field, blank; "===>" is no name');
  const entry = orderEntry();
  assert.deepEqual(checkAt(entry, { row: 4, col: 20 }), { at: '4:20', equals: '', label: 'Customer' });
  assert.deepEqual(messageCheck('  Order 9 not found.  '), { message: true, contains: 'Order 9 not found.' });
  assert.deepEqual(messageCheck(''), { message: true, equals: '' }, 'no message now: that there is none');
});

test('a check\'s test changes keep its value; checks go on a step or the end, and empty ones are left out', () => {
  const c = { at: '1:74', equals: 'PUB400', label: 'System' };
  assert.equal(testOf(c), 'equals');
  assert.deepEqual(setTest(c, 'contains'), { at: '1:74', label: 'System', contains: 'PUB400' });
  assert.deepEqual(setTest(c, 'matches', 'PUB\\d+'), { at: '1:74', label: 'System', matches: 'PUB\\d+' });

  const withStep = setChecks(recorded, 1, [c]);
  assert.deepEqual(checksOf(withStep, 1), [c]);
  assert.deepEqual(checksOf(withStep, 0), []);
  assert.equal(setChecks(withStep, 1, []).steps[1]!.expect, undefined, 'no checks: no expect in the file');

  const menu = mainMenu();
  const ends = endHere(setChecks(recorded, 'end', [c]), menu, 'IBM i Main Menu');
  assert.deepEqual(ends.end, { expect: [c], screen: screenId(menu), title: 'IBM i Main Menu' });
  assert.deepEqual(endAnywhere(ends).end, { expect: [c] }, 'the checks stay');
  assert.equal(setChecks(endAnywhere(ends), 'end', []).end, undefined, 'nothing left: no end');
  assert.deepEqual(validateMacro(ends).end, ends.end, 'valid as the panel makes it');
});

test('a recorded macro ends where checks were added when recording stopped', () => {
  const end = { screen: 'c3c3c3c3c3c3c3', title: 'Order 12345', expect: [{ message: true as const, equals: '' }] };
  const m = newMacro(recorded.steps, '5250', [], end);
  assert.deepEqual(m.end, end);
  assert.deepEqual(validateMacro(m).end, end);
});
