// An input bound to a host field, shared by the modern and classic views.

import { hostToIso, hostToTime, isoToHost, timeHasSeconds, timeToHost, type Widget } from '@veneer/screens';
import type { AidName, FieldSnapshot } from '@veneer/terminal';
import { monocase } from '@veneer/terminal';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Option } from '@veneer/view';
import { filterValue, isNumeric, overtyped, withSign, isShortField } from './fieldRules.ts';
import { LookupField, MaskField, RadioField, SpinnerField, TextAreaField } from './widgets.tsx';

export interface FieldBinding {
  value: (f: FieldSnapshot) => string;
  onChange: (f: FieldSnapshot, value: string) => void;
  /** An auto-enter field was filled: submit Enter with this value. */
  onAutoEnter: (f: FieldSnapshot, value: string) => void;
  /** Typing replaces the character at the caret (a 3270 with Insert off) rather than inserting. */
  overtype?: boolean;
  /** Press a key with the cursor in a field, such as a lookup's F4 prompt. */
  onKey?: (f: FieldSnapshot, aid: AidName) => void;
}

const NUMERIC_KEYBOARD: ReadonlySet<string | undefined> = new Set(['numericOnly', 'digitsOnly', 'signedNumeric']);

export function FieldInput(props: {
  field: FieldSnapshot;
  binding: FieldBinding;
  style?: CSSProperties;
  className?: string;
  label?: string | undefined;
  /** Subfile option codes: a compact dropdown that shows only the code once chosen. */
  options?: Option[] | undefined;
  /** A widget set by a screen customization. */
  widget?: Widget | undefined;
  /** A text area's fields, this one first (see FieldItem.parts). */
  parts?: FieldSnapshot[] | undefined;
  /** Designer mode: not editable. (The designer canvas also swallows clicks.) */
  readOnly?: boolean | undefined;
  /** Position tag the designer uses to identify the item ("row:col"). */
  dataAt?: string | undefined;
}) {
  const { field, binding, style, label, widget } = props;
  const options = widget?.type === 'select' ? widget.options : props.options;
  const compact = widget?.type !== 'select';
  const readOnly = props.readOnly ?? false;
  const className = ['field', props.className, field.mandatoryEnter ? 'required' : '', isNumeric(field) ? 'numeric' : '']
    .filter(Boolean).join(' ');
  const value = binding.value(field);

  const common = { field, binding, style, className, label, readOnly, dataAt: props.dataAt };
  if (widget?.type === 'radio') return <RadioField {...common} widget={widget} />;
  if (widget?.type === 'spinner') return <SpinnerField {...common} widget={widget} />;
  if (widget?.type === 'textarea' && props.parts && props.parts.length > 0) return <TextAreaField {...common} parts={props.parts} />;
  if (widget?.type === 'mask') return <MaskField {...common} widget={widget} />;
  if (widget?.type === 'lookup') return <LookupField {...common} widget={widget} />;

  if (widget?.type === 'toggle') {
    const on = value.trim() === widget.on.trim();
    return (
      <span className="toggle-field" style={style}>
        <input
          type="checkbox"
          role="switch"
          data-field={field.id}
          data-at={props.dataAt}
          aria-label={label}
          aria-checked={on}
          checked={on}
          onChange={(e) => binding.onChange(field, e.target.checked ? widget.on : widget.off)}
        />
      </span>
    );
  }

  if (widget?.type === 'time') {
    return (
      <input
        className={`${className} time-field`}
        style={style}
        type="time"
        step={timeHasSeconds(widget.format) ? 1 : 60}
        data-field={field.id}
        data-at={props.dataAt}
        readOnly={readOnly}
        aria-label={label}
        value={hostToTime(value, widget.format)}
        onChange={(e) => binding.onChange(field, timeToHost(e.target.value, widget.format))}
      />
    );
  }

  if (widget?.type === 'checkbox') {
    return (
      <span className="checkbox-field" style={style}>
        <input
          type="checkbox"
          data-field={field.id}
        data-at={props.dataAt}
          aria-label={label}
          checked={value.trim() === widget.on}
          onChange={(e) => binding.onChange(field, e.target.checked ? widget.on : widget.off)}
        />
      </span>
    );
  }

  if (widget?.type === 'date') {
    return (
      <input
        className={`${className} date-field`}
        style={style}
        type="date"
        data-field={field.id}
        data-at={props.dataAt}
        readOnly={readOnly}
        aria-label={label}
        value={hostToIso(value, widget.format)}
        onChange={(e) => binding.onChange(field, isoToHost(e.target.value, widget.format))}
      />
    );
  }

  if (options && options.length > 0) {
    const current = options.some((o) => o.value === value.trim()) ? value.trim() : '';
    return (
      <select
        className={`${className}${compact ? ' option-select' : ' widget-select'}`}
        style={style}
        data-field={field.id}
        data-at={props.dataAt}
        aria-label={label ?? 'Option'}
        value={current}
        onChange={(e) => binding.onChange(field, e.target.value)}
      >
        <option value="" />
        {options.map((o) => (
          // A compact select shows only the code once chosen, so it fits the column.
          <option key={o.value} value={o.value}>
            {!compact ? o.label : o.value === current ? o.value : `${o.value} = ${o.label}`}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      className={isShortField(field) ? `${className} short` : className}
      style={style}
      data-field={field.id}
      data-at={props.dataAt}
      aria-label={label}
      type={field.attr.nonDisplay ? 'password' : 'text'}
      inputMode={NUMERIC_KEYBOARD.has(field.shift) || field.numeric ? 'decimal' : undefined}
      autoComplete={field.attr.nonDisplay ? 'current-password' : 'off'}
      spellCheck={false}
      maxLength={field.length}
      readOnly={readOnly}
      value={value}
      onChange={(e) => {
        const raw = field.monocase ? monocase(e.target.value) : e.target.value;
        const v = filterValue(field, raw);
        binding.onChange(field, v);
        if (v.length === field.length && e.target.selectionStart === v.length) {
          // 5250 behaviour: a full field submits (auto-enter) or advances to the next one.
          if (field.autoEnter) binding.onAutoEnter(field, v);
          else focusNext(e.target);
        }
      }}
      onKeyDown={(e) => {
        if (binding.overtype && overtype(e, field, value, binding)) return;
        // Field+ / Field- on the numeric keypad set the sign and move on.
        if (!isNumeric(field) || (e.code !== 'NumpadAdd' && e.code !== 'NumpadSubtract')) return;
        e.preventDefault();
        binding.onChange(field, withSign(value, e.code === 'NumpadSubtract'));
        focusNext(e.currentTarget);
      }}
    />
  );
}

/**
 * Typing over: a printable key replaces the character at the caret, as a
 * 3270 does with Insert off. Returns true when it handled the key.
 */
function overtype(e: ReactKeyboardEvent<HTMLInputElement>, field: FieldSnapshot, value: string, binding: FieldBinding): boolean {
  const input = e.currentTarget;
  const at = input.selectionStart ?? 0;
  if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey || at !== input.selectionEnd || at >= value.length) return false;
  e.preventDefault();
  const next = overtyped(field, value, at, e.key);
  if (next === null) return true;
  // Change the input itself first, caret included: React then finds the value
  // already there and leaves the caret alone, however fast the next key comes.
  input.value = next;
  input.setSelectionRange(at + 1, at + 1);
  binding.onChange(field, next);
  if (at + 1 >= field.length) focusNext(input);
  return true;
}

/** Move to the next field, as a full 5250 field does (a radio group: its chosen button). */
export function focusNext(el: HTMLElement): void {
  const all = [...document.querySelectorAll<HTMLElement>('[data-field]')];
  all[all.indexOf(el) + 1]?.focus();
}
