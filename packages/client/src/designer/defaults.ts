// What the designer starts a widget or display with, and the "Show as"
// choices it offers (kept apart from the panels so they can be tested).

import type { Display, Widget } from '@veneer/screens';
import type { FieldSnapshot } from '@veneer/terminal';
import { takesNumbers } from '../ui/fieldRules.ts';

/** The "Show as" choices for a field, besides Component. */
export function showAsChoices(f: FieldSnapshot, current: Widget | undefined): Array<{ value: string; label: string }> {
  return [
    { value: 'text', label: 'Text box' },
    { value: 'select', label: 'Dropdown' },
    { value: 'radio', label: 'Radio buttons' },
    { value: 'checkbox', label: 'Checkbox' },
    { value: 'toggle', label: 'Switch' },
    { value: 'date', label: 'Date picker' },
    { value: 'time', label: 'Time picker' },
    ...(takesNumbers(f) || current?.type === 'spinner' ? [{ value: 'spinner', label: 'Spinner' }] : []),
    { value: 'textarea', label: 'Text area' },
    { value: 'mask', label: 'Masked input' },
    { value: 'lookup', label: 'Lookup' },
  ];
}

/** A new widget of a type, started from the field's value where that helps. */
export function defaultWidget(type: string, f: Pick<FieldSnapshot, 'id' | 'value' | 'length'>): Widget | null {
  const choices = f.value ? [{ value: f.value, label: f.value }] : [];
  switch (type) {
    case 'select': return { type: 'select', options: choices };
    case 'radio': return { type: 'radio', options: choices, layout: 'row' };
    case 'checkbox': return { type: 'checkbox', on: 'Y', off: 'N' };
    case 'toggle': return { type: 'toggle', on: 'Y', off: 'N' };
    case 'date': return { type: 'date', format: 'YYYYMMDD' };
    // A time field's length says which format it most likely has.
    case 'time': return { type: 'time', format: f.length === 4 ? 'HHMM' : f.length === 8 ? 'HH:MM:SS' : f.length === 5 ? 'HH:MM' : 'HHMMSS' };
    case 'mask': return { type: 'mask', mask: '9'.repeat(Math.max(1, Math.min(f.length, 132))) };
    case 'lookup': return { type: 'lookup', prompt: { aid: 'F4' } };
    case 'spinner': return { type: 'spinner' };
    case 'textarea': return { type: 'textarea', fields: [f.id] };
    default: return null;
  }
}

/** The "Show as" choices for output text. */
export const DISPLAY_CHOICES: Array<{ value: Display['type']; label: string }> = [
  { value: 'badge', label: 'Status badge' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'yesno', label: 'Yes or no' },
  { value: 'link', label: 'Link' },
  { value: 'progress', label: 'Progress bar' },
  { value: 'barcode', label: 'Barcode or QR code' },
];

/** A new display of a type, started from the text where that helps. */
export function defaultDisplay(type: string, text: string): Display | null {
  const value = text.trim();
  switch (type) {
    case 'badge': return { type: 'badge', values: value ? [{ value, role: 'accent' }] : [] };
    case 'number': return { type: 'number' };
    case 'date': return { type: 'date', format: value.length === 6 ? 'MMDDYY' : 'YYYYMMDD' };
    case 'yesno': return { type: 'yesno', yes: 'Y', no: 'N' };
    case 'link': return { type: 'link', to: value.includes('@') ? 'email' : /^[+\d\s().-]{7,}$/.test(value) ? 'phone' : 'url' };
    case 'progress': return { type: 'progress', max: 100 };
    case 'barcode': return { type: 'barcode', format: 'qr', height: 4 };
    default: return null;
  }
}

