// The radio button, spinner and text area widgets (see fieldInput.tsx for the
// others). Each draws one or more 5250 fields differently; the host sees the
// same fields and values as on a terminal.

import type { Widget } from '@veneer/screens';
import type { FieldSnapshot } from '@veneer/terminal';
import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import type { FieldBinding } from './fieldInput.tsx';
import { filterValue, isNumeric, withSign } from './fieldRules.ts';
import { focusNext } from './fieldInput.tsx';
import { keyHint } from './keys.ts';
import { applyMask, caretAfter, maskComplete, maskedText, slotsBefore } from './mask.ts';
import { stepValue } from './spinner.ts';
import { fitText, roomLeft, textOf } from './textArea.ts';

interface Common {
  field: FieldSnapshot;
  binding: FieldBinding;
  style?: CSSProperties | undefined;
  className: string;
  label?: string | undefined;
  readOnly: boolean;
  dataAt?: string | undefined;
}

export function RadioField({ field, binding, style, label, readOnly, dataAt, widget }: Common & { widget: Extract<Widget, { type: 'radio' }> }) {
  const value = binding.value(field).trim();
  const choices = widget.allowClear ? [...widget.options, { value: '', label: 'None' }] : widget.options;
  // A value no choice matches shows none chosen, and stays as it is until one is picked.
  const chosen = choices.some((o) => o.value === value) ? value : undefined;
  // Tab stops on the chosen button, or the first when none is: as a native group does.
  const stop = chosen ?? choices[0]?.value;
  return (
    <span className={`radio-field ${widget.layout === 'column' ? 'column' : 'row'}`} style={style} role="radiogroup" aria-label={label} data-at={dataAt}>
      {choices.map((o) => (
        <label key={o.value} className="radio-choice">
          <input
            type="radio"
            name={`field-${field.id}`}
            value={o.value}
            checked={o.value === chosen}
            disabled={readOnly}
            tabIndex={o.value === stop ? 0 : -1}
            {...(o.value === stop ? { 'data-field': field.id } : { 'data-field-of': field.id })}
            onChange={() => binding.onChange(field, o.value)}
          />
          {o.label}
        </label>
      ))}
    </span>
  );
}

export function SpinnerField({ field, binding, style, className, label, readOnly, dataAt, widget }: Common & { widget: Extract<Widget, { type: 'spinner' }> }) {
  const value = binding.value(field);
  const step = (up: boolean) => {
    if (readOnly) return;
    const next = stepValue(value, field, widget, up);
    if (next !== null) binding.onChange(field, next);
  };
  return (
    <span className="spinner-field" style={style} data-at={dataAt}>
      <input
        className={`${className} numeric`}
        data-field={field.id}
        aria-label={label}
        role="spinbutton"
        aria-valuemin={widget.min}
        aria-valuemax={widget.max}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        maxLength={field.length}
        readOnly={readOnly}
        value={value}
        onChange={(e) => binding.onChange(field, filterValue(field, e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            step(e.key === 'ArrowUp');
          } else if (isNumeric(field) && (e.code === 'NumpadAdd' || e.code === 'NumpadSubtract')) {
            e.preventDefault();
            binding.onChange(field, withSign(value, e.code === 'NumpadSubtract'));
          }
        }}
      />
      <span className="spinner-buttons">
        <button type="button" tabIndex={-1} aria-label="Up" disabled={readOnly} onClick={() => step(true)}>▴</button>
        <button type="button" tabIndex={-1} aria-label="Down" disabled={readOnly} onClick={() => step(false)}>▾</button>
      </span>
    </span>
  );
}

export function TextAreaField({ binding, style, className, label, readOnly, dataAt, parts }: Common & { parts: FieldSnapshot[] }) {
  const values = parts.map((f) => binding.value(f));
  const text = textOf(values);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Where the caret goes once the fitted text is drawn.
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && caret.current !== null && document.activeElement === el) el.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });
  const room = roomLeft(values, parts);
  const first = parts[0]!;
  return (
    <span className={`textarea-field${readOnly ? ' designing' : ''}`} style={style} data-at={dataAt}>
      <textarea
        ref={ref}
        className={`${className} textarea`}
        data-field={first.id}
        data-fields={parts.map((f) => f.id).join(' ')}
        aria-label={label}
        aria-description={`${parts.length} lines, ${room} characters left`}
        rows={readOnly ? 1 : parts.length}
        style={{ '--lines': parts.length } as CSSProperties}
        wrap="off"
        spellCheck={false}
        autoComplete="off"
        readOnly={readOnly}
        value={text}
        onChange={(e) => {
          const el = e.target;
          const fitted = fitText(el.value, el.selectionStart, parts);
          if (!fitted) {
            // No room: refuse the edit, leaving the caret where it was.
            const back = Math.max(0, el.selectionStart - (el.value.length - text.length));
            queueMicrotask(() => el.setSelectionRange(back, back));
            el.classList.remove('full');
            void el.offsetWidth;
            el.classList.add('full');
            return;
          }
          caret.current = fitted.caret;
          parts.forEach((f, i) => {
            if (fitted.values[i] !== binding.value(f)) binding.onChange(f, fitted.values[i]!);
          });
          // The text fitted as typed: React leaves the box alone, so put the caret back now.
          if (textOf(fitted.values) === el.value) caret.current = null;
        }}
      />
      {!readOnly && <span className={`textarea-room${room === 0 ? ' none' : ''}`} aria-hidden>{room} left</span>}
    </span>
  );
}

/**
 * Masked input: the box shows the separators, and typing only fills the
 * mask's slots. The host gets the typed characters, or with `literals` the
 * text as shown. A full box moves to the next field, as a full field does.
 */
export function MaskField({ field, binding, style, className, label, readOnly, dataAt, widget }: Common & { widget: Extract<Widget, { type: 'mask' }> }) {
  const shown = maskedText(binding.value(field), widget);
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && caret.current !== null && document.activeElement === el) el.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });
  return (
    <input
      ref={ref}
      className={`${className} mask-field`}
      // Wide enough for the separators too, which the host field may not hold.
      style={{ ...style, minWidth: `calc(${[...widget.mask].length + 1} * var(--cw) + 14px)` }}
      data-field={field.id}
      data-at={dataAt}
      aria-label={label}
      aria-description={`Format ${widget.mask}`}
      placeholder={widget.mask.replace(/[9AX]/g, '_')}
      autoComplete="off"
      spellCheck={false}
      inputMode={/^[^AX]*$/.test(widget.mask) ? 'numeric' : undefined}
      maxLength={[...widget.mask].length}
      readOnly={readOnly}
      value={shown}
      onChange={(e) => {
        const el = e.target;
        const typed = field.monocase ? el.value.toUpperCase() : el.value;
        const at = el.selectionStart ?? typed.length;
        const next = applyMask(typed, widget);
        // The caret stays after the same typed character, separators or not.
        caret.current = caretAfter(next.shown, slotsBefore(typed.slice(0, at), widget), widget);
        binding.onChange(field, next.host);
        if (maskComplete(next.shown, widget) && caret.current >= next.shown.length) {
          if (field.autoEnter) binding.onAutoEnter(field, next.host);
          else focusNext(el);
        }
      }}
    />
  );
}

/**
 * A text box with suggestions (the browser's own list, filtered as the user
 * types: value and label both match), and with `prompt` a button that
 * presses its key with the cursor here, such as F4 for the host's prompt.
 * Any value can still be typed; the field's rules apply as usual.
 */
export function LookupField({ field, binding, style, className, label, readOnly, dataAt, widget }: Common & { widget: Extract<Widget, { type: 'lookup' }> }) {
  const value = binding.value(field);
  const list = widget.options?.length ? `lookup-${field.id.replace(':', '-')}` : undefined;
  const prompt = widget.prompt;
  // The box keeps the field's width; the look-up button goes after it, so even a short field has room to type in.
  const { width, ...place } = style ?? {};
  return (
    <span className={`lookup-field${prompt ? ' with-prompt' : ''}`} style={place} data-at={dataAt}>
      <input
        className={`${className} lookup`}
        style={width !== undefined ? { width } : undefined}
        data-field={field.id}
        aria-label={label}
        list={list}
        autoComplete="off"
        spellCheck={false}
        maxLength={field.length}
        readOnly={readOnly}
        value={value}
        onChange={(e) => binding.onChange(field, filterValue(field, field.monocase ? e.target.value.toUpperCase() : e.target.value))}
      />
      {list && (
        <datalist id={list}>
          {widget.options!.map((o) => <option key={o.value} value={o.value}>{o.label === o.value ? undefined : o.label}</option>)}
        </datalist>
      )}
      {prompt && (
        <button
          type="button"
          className="lookup-prompt"
          tabIndex={-1}
          aria-label={`Look up (${keyHint(prompt.aid)})`}
          title={`Look up (${keyHint(prompt.aid)})`}
          disabled={readOnly || !binding.onKey}
          onClick={() => binding.onKey?.(field, prompt.aid)}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="m10 10 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      )}
    </span>
  );
}
