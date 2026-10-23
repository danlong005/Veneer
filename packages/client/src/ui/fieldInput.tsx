// An input bound to a 5250 field, shared by the modern and classic views.

import type { FieldSnapshot } from '@veneer/tn5250';
import type { CSSProperties } from 'react';
import type { Option } from '../transform/types.ts';

export interface FieldBinding {
  value: (f: FieldSnapshot) => string;
  onChange: (f: FieldSnapshot, value: string) => void;
}

const NUMERIC = new Set(['numericOnly', 'digitsOnly', 'signedNumeric']);

export function FieldInput(props: {
  field: FieldSnapshot;
  binding: FieldBinding;
  style?: CSSProperties;
  className?: string;
  label?: string | undefined;
  options?: Option[] | undefined;
}) {
  const { field, binding, style, label, options } = props;
  const className = ['field', props.className, field.mandatoryEnter ? 'required' : ''].filter(Boolean).join(' ');
  const value = binding.value(field);

  if (options && options.length > 0) {
    const current = options.some((o) => o.value === value.trim()) ? value.trim() : '';
    return (
      <select
        className={`${className} option-select`}
        style={style}
        data-field={field.id}
        aria-label={label ?? 'Option'}
        value={current}
        onChange={(e) => binding.onChange(field, e.target.value)}
      >
        <option value="" />
        {options.map((o) => (
          // The closed select shows only the code so it fits the column.
          <option key={o.value} value={o.value}>{o.value === current ? o.value : `${o.value} = ${o.label}`}</option>
        ))}
      </select>
    );
  }

  return (
    <input
      className={className}
      style={style}
      data-field={field.id}
      aria-label={label}
      type={field.attr.nonDisplay ? 'password' : 'text'}
      inputMode={NUMERIC.has(field.shift) ? 'decimal' : undefined}
      autoComplete={field.attr.nonDisplay ? 'current-password' : 'off'}
      spellCheck={false}
      maxLength={field.length}
      value={value}
      onChange={(e) => {
        const v = field.monocase ? e.target.value.toUpperCase() : e.target.value;
        binding.onChange(field, v);
        // 5250 behaviour: a full field advances to the next one.
        if (v.length === field.length && e.target.selectionStart === v.length) focusNext(e.target);
      }}
    />
  );
}

function focusNext(el: HTMLElement): void {
  const all = [...document.querySelectorAll<HTMLElement>('[data-field]')];
  all[all.indexOf(el) + 1]?.focus();
}
