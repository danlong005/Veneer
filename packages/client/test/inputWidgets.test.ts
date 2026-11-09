// The switch, time picker, masked input and lookup: the masked input's
// typing rules, how a definition sets each on its field, and what the
// designer starts each with.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { validateDefinition, type Change, type ScreenDefinition, type Widget } from '@veneer/screens';
import { describeChange } from '../src/designer/changes.ts';
import { defaultWidget, showAsChoices } from '../src/designer/defaults.ts';
import { customize } from '@veneer/view';
import { transform, type FieldItem, type Item } from '@veneer/view';
import { applyMask, caretAfter, maskComplete, maskLength, maskedText, slotCount, slotTakes, slotsBefore } from '../src/ui/mask.ts';
import { orderNotes } from './screens.ts';

type Mask = Extract<Widget, { type: 'mask' }>;
const ssn: Mask = { type: 'mask', mask: '999-99-9999' };
const ssnKept: Mask = { ...ssn, literals: true };
const phone: Mask = { type: 'mask', mask: '(999) 999-9999' };
const part: Mask = { type: 'mask', mask: 'AA-9999' };

describe('masked input', () => {
  test('what each slot takes', () => {
    assert.ok(slotTakes('9', '7') && !slotTakes('9', 'a'));
    assert.ok(slotTakes('A', 'q') && slotTakes('A', 'É') && !slotTakes('A', '1'));
    assert.ok(slotTakes('X', '#') && slotTakes('X', 'a'));
    assert.equal(slotCount('(999) 999-9999'), 10);
  });

  test('separators appear as the slots after them fill', () => {
    assert.deepEqual(applyMask('123', ssn), { shown: '123', host: '123' });
    assert.deepEqual(applyMask('1234', ssn), { shown: '123-4', host: '1234' });
    assert.deepEqual(applyMask('123456789', ssn), { shown: '123-45-6789', host: '123456789' });
    assert.deepEqual(applyMask('5551234567', phone), { shown: '(555) 123-4567', host: '5551234567' });
  });

  test('separators typed by hand, and characters a slot won\'t take, are passed over', () => {
    assert.deepEqual(applyMask('123-45-6789', ssn), { shown: '123-45-6789', host: '123456789' });
    assert.deepEqual(applyMask('12a3', ssn), { shown: '123', host: '123' });
    assert.deepEqual(applyMask('ab12cd34', part), { shown: 'ab-1234', host: 'ab1234' });
    assert.deepEqual(applyMask('1234567890123', ssn).host, '123456789', 'nothing past the last slot');
  });

  test('with literals, the host gets the text as shown', () => {
    assert.deepEqual(applyMask('123456789', ssnKept), { shown: '123-45-6789', host: '123-45-6789' });
    assert.equal(maskLength(ssnKept), 11);
    assert.equal(maskLength(ssn), 9);
  });

  test('the host\'s value, with or without separators, shows the same', () => {
    assert.equal(maskedText('123456789', ssn), '123-45-6789');
    assert.equal(maskedText('123-45-6789', ssnKept), '123-45-6789');
    assert.equal(maskedText('1234     ', ssn), '123-4', 'the field\'s trailing blanks');
    assert.equal(maskedText('', ssn), '');
  });

  test('complete only when every slot is filled', () => {
    assert.ok(maskComplete(applyMask('123456789', ssn).shown, ssn));
    assert.ok(!maskComplete(applyMask('12345678', ssn).shown, ssn));
  });

  test('the caret stays after the same typed character when separators come and go', () => {
    // Typing the 4th digit at the end: the caret goes after it, past the new "-".
    assert.equal(caretAfter('123-4', slotsBefore('1234', ssn), ssn), 5);
    // Deleting the "-" after "123" (caret after 3): the digit after moves up; the caret stays after "3".
    assert.equal(caretAfter(applyMask('1234', ssn).shown, slotsBefore('123', ssn), ssn), 3);
    assert.equal(caretAfter('(555) 1', slotsBefore('(555', phone), phone), 4);
    assert.equal(caretAfter('123', 0, ssn), 0);
  });
});

const definition = (changes: Change[]): ScreenDefinition =>
  validateDefinition({ id: 'test', name: 'Test', match: { screenIds: ['0a1b2c3d4e5f60'], text: [] }, changes });
const fieldItem = (items: Item[], id: string) => items.find((i): i is FieldItem => i.kind === 'field' && i.field.id === id);

describe('applying the input widgets to a screen', () => {
  test('each is set on its field, as given', () => {
    const widgets: Array<[string, Widget]> = [
      ['4:20', { type: 'lookup', options: [{ value: 'A', label: 'Air' }], prompt: { aid: 'F4' } }],
      ['5:20', { type: 'mask', mask: '99999' }],
      ['6:20', { type: 'time', format: 'HHMM' }],
      ['8:20', { type: 'toggle', on: 'Y', off: 'N' }],
    ];
    const view = customize(transform(orderNotes()), definition(widgets.map(([field, widget]) => ({ op: 'widget', field, widget }))));
    for (const [id, widget] of widgets) assert.deepEqual(fieldItem(view.items, id)?.widget, widget, id);
  });

  test('a field in a text area can\'t also be a switch', () => {
    assert.throws(() => definition([
      { op: 'widget', field: '8:20', widget: { type: 'textarea', fields: ['8:20', '9:20'] } },
      { op: 'widget', field: '9:20', widget: { type: 'toggle', on: 'Y', off: 'N' } },
    ]), /is part of the text area/);
  });

  test('the Changes list names each', () => {
    const snap = orderNotes();
    const view = transform(snap);
    const line = (widget: Widget) => describeChange({ op: 'widget', field: '4:20', widget }, view, snap).label;
    assert.match(line({ type: 'toggle', on: 'Y', off: 'N' }), /as a switch$/);
    assert.match(line({ type: 'time', format: 'HHMM' }), /as a time picker$/);
    assert.match(line({ type: 'mask', mask: '999' }), /as a masked input$/);
    assert.match(line({ type: 'lookup', prompt: { aid: 'F4' } }), /as a lookup$/);
  });
});

describe('designer: starting a widget', () => {
  const field = (length: number, value = '') => ({ id: '6:20', value, length });

  test('every field offers the new widgets; the spinner only numeric ones', () => {
    const snap = orderNotes();
    const text = snap.fields.find((f) => f.id === '8:20')!;
    const numeric = snap.fields.find((f) => f.id === '5:20')!;
    const values = (f: typeof text) => showAsChoices(f, undefined).map((c) => c.value);
    for (const w of ['toggle', 'time', 'mask', 'lookup']) assert.ok(values(text).includes(w), w);
    assert.ok(!values(text).includes('spinner'));
    assert.ok(values(numeric).includes('spinner'));
  });

  test('a time picker guesses the format from the field\'s length', () => {
    assert.deepEqual(defaultWidget('time', field(4)), { type: 'time', format: 'HHMM' });
    assert.deepEqual(defaultWidget('time', field(6)), { type: 'time', format: 'HHMMSS' });
    assert.deepEqual(defaultWidget('time', field(5)), { type: 'time', format: 'HH:MM' });
    assert.deepEqual(defaultWidget('time', field(8)), { type: 'time', format: 'HH:MM:SS' });
  });

  test('a mask starts as one digit per character; a lookup with F4; a switch Y and N', () => {
    assert.deepEqual(defaultWidget('mask', field(5)), { type: 'mask', mask: '99999' });
    assert.deepEqual(defaultWidget('lookup', field(5)), { type: 'lookup', prompt: { aid: 'F4' } });
    assert.deepEqual(defaultWidget('toggle', field(1)), { type: 'toggle', on: 'Y', off: 'N' });
  });

  test('what each starts with is a valid definition', () => {
    for (const type of ['select', 'radio', 'checkbox', 'toggle', 'date', 'time', 'spinner', 'mask', 'lookup']) {
      const w = defaultWidget(type, field(6, 'A'))!;
      assert.doesNotThrow(() => definition([{ op: 'widget', field: '6:20', widget: w }]), type);
    }
  });
});
