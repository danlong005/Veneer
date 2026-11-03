import assert from 'node:assert/strict';
import { test } from 'node:test';
import { screenId, validateMacro, type Macro } from '@veneer/screens';
import {
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
