// The designer's field widgets: the "Show as" choices for an input field, and
// the settings of each widget (choices, date format, limits, text area lines).

import { DATE_FORMATS, MASK_SLOTS, TIME_FORMATS, type DateFormat, type ScreenDefinition, type TimeFormat, type Widget } from '@veneer/screens';
import type { AidName, FieldSnapshot, ScreenSnapshot } from '@veneer/terminal';
import { useState } from 'react';
import { buttonAids, keyHint } from '../ui/keys.ts';
import { maskLength, slotCount } from '../ui/mask.ts';
import { fieldsBelow, formatOptions, parseOptions, toggleTextAreaField, widgetOf } from './edit.ts';
export { defaultWidget, showAsChoices } from './defaults.ts';

/** A number box's value: blank for none. */
const numberOf = (text: string): number | undefined => {
  const n = Number(text);
  return text.trim() === '' || !Number.isFinite(n) ? undefined : n;
};

export function WidgetEditor({ widget, field, onChange, text }: {
  widget: Widget;
  field: FieldSnapshot;
  onChange: (w: Widget) => void;
  /** Text area settings, which edit the definition (and the screen) directly. */
  text: { draft: ScreenDefinition; setDraft: (d: ScreenDefinition) => void; snap: ScreenSnapshot; joining: boolean; onJoining: (on: boolean) => void };
}) {
  // Keep the options text as typed; parse it on every change.
  const [optionsText, setOptionsText] = useState(
    widget.type === 'select' || widget.type === 'radio' ? formatOptions(widget.options) : widget.type === 'lookup' ? formatOptions(widget.options ?? []) : '',
  );
  const choices = (make: (options: ReturnType<typeof parseOptions>) => Widget) => (
    <label className="dp-row">Choices, one per line as value=Label
      <textarea
        rows={5}
        value={optionsText}
        onChange={(e) => {
          setOptionsText(e.target.value);
          onChange(make(parseOptions(e.target.value)));
        }}
      />
    </label>
  );
  switch (widget.type) {
    case 'select':
      return choices((options) => ({ type: 'select', options }));
    case 'radio':
      return (
        <>
          {choices((options) => ({ ...widget, options }))}
          <label className="dp-row">Layout
            <select value={widget.layout ?? 'row'} onChange={(e) => onChange({ ...widget, layout: e.target.value as 'row' | 'column' })}>
              <option value="row">Side by side</option>
              <option value="column">One under another</option>
            </select>
          </label>
          <label className="dp-check">
            <input type="checkbox" checked={widget.allowClear === true} onChange={(e) => {
              const { allowClear: _omit, ...rest } = widget;
              onChange(e.target.checked ? { ...rest, allowClear: true } : rest);
            }} /> Add a “None” choice, which clears the field
          </label>
          {widget.layout === 'column' && <p className="dp-hint">The choices take a row each: leave room below, or move what is there.</p>}
        </>
      );
    case 'toggle':
    case 'checkbox':
      return (
        <div className="dp-pair">
          <label className="dp-row">{widget.type === 'toggle' ? 'On value' : 'Checked value'}<input value={widget.on} onChange={(e) => onChange({ ...widget, on: e.target.value })} /></label>
          <label className="dp-row">{widget.type === 'toggle' ? 'Off value' : 'Unchecked value'}<input value={widget.off} onChange={(e) => onChange({ ...widget, off: e.target.value })} /></label>
        </div>
      );
    case 'date':
      return (
        <label className="dp-row">Host date format
          <select value={widget.format} onChange={(e) => onChange({ type: 'date', format: e.target.value as DateFormat })}>
            {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
      );
    case 'time':
      return (
        <label className="dp-row">Host time format
          <select value={widget.format} onChange={(e) => onChange({ type: 'time', format: e.target.value as TimeFormat })}>
            {TIME_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          {[...widget.format].length !== field.length && <span className="dp-warn">The field holds {field.length} characters; this format has {widget.format.length}.</span>}
        </label>
      );
    case 'mask':
      return <MaskEditor widget={widget} field={field} onChange={onChange} />;
    case 'lookup':
      return (
        <>
          <label className="dp-row">Suggestions, one per line as value=Label
            <textarea rows={5} value={optionsText} placeholder="none" onChange={(e) => {
              setOptionsText(e.target.value);
              const options = parseOptions(e.target.value);
              const { options: _omit, ...rest } = widget;
              onChange(options.length > 0 ? { ...rest, options } : rest);
            }} />
          </label>
          <label className="dp-row">Look-up button presses
            <select value={widget.prompt?.aid ?? ''} onChange={(e) => {
              const { prompt: _omit, ...rest } = widget;
              onChange(e.target.value ? { ...rest, prompt: { aid: e.target.value as AidName } } : rest);
            }}>
              <option value="">No button</option>
              {buttonAids(text.snap.host).map((a) => <option key={a} value={a}>{keyHint(a, text.snap.host)}</option>)}
            </select>
          </label>
          <p className="dp-hint">The button presses the key with the cursor in this field: F4 opens the host's own prompt for it on most IBM i screens.</p>
          {!widget.options?.length && !widget.prompt && <p className="dp-warn">Add suggestions, a look-up key, or both.</p>}
        </>
      );
    case 'spinner':
      return <SpinnerEditor widget={widget} field={field} onChange={onChange} />;
    case 'textarea':
      return <TextAreaEditor first={field} {...text} />;
  }
}

function MaskEditor({ widget, field, onChange }: {
  widget: Extract<Widget, { type: 'mask' }>; field: FieldSnapshot; onChange: (w: Widget) => void;
}) {
  const need = maskLength(widget);
  const slots = slotCount(widget.mask);
  return (
    <>
      <label className="dp-row">Mask
        <input value={widget.mask} spellCheck={false} maxLength={132} aria-invalid={slots === 0} placeholder="999-99-9999"
          onChange={(e) => onChange({ ...widget, mask: e.target.value })} />
      </label>
      <p className="dp-hint">
        {Object.entries(MASK_SLOTS).map(([c, what], i) => <span key={c}>{i > 0 ? ', ' : ''}<code>{c}</code> {what}</span>)}; anything else is a
        separator the box adds by itself.
      </p>
      <label className="dp-check">
        <input type="checkbox" checked={widget.literals === true} onChange={(e) => {
          const { literals: _omit, ...rest } = widget;
          onChange(e.target.checked ? { ...rest, literals: true } : rest);
        }} /> The host field holds the separators too
      </label>
      {slots === 0
        ? <p className="dp-warn">A mask needs at least one 9, A or X.</p>
        : need !== field.length && (
          <p className="dp-warn">
            The field holds {field.length} characters; the mask {widget.literals ? 'is' : 'takes'} {need}.
            {!widget.literals && [...widget.mask].length === field.length ? ' Tick the box above if the host keeps the separators.' : ''}
          </p>
        )}
    </>
  );
}

function SpinnerEditor({ widget, field, onChange }: {
  widget: Extract<Widget, { type: 'spinner' }>; field: FieldSnapshot; onChange: (w: Widget) => void;
}) {
  // As typed, so "-" or "1." can be on the way to a number.
  const [typed, setTyped] = useState({ min: String(widget.min ?? ''), max: String(widget.max ?? ''), step: String(widget.step ?? '') });
  const set = (key: 'min' | 'max' | 'step', text: string) => {
    setTyped((t) => ({ ...t, [key]: text }));
    const { [key]: _omit, ...rest } = widget;
    const n = numberOf(text);
    onChange(n === undefined || (key === 'step' && n <= 0) ? rest : { ...rest, [key]: n });
  };
  const box = (key: 'min' | 'max' | 'step', label: string, placeholder: string) => (
    <label className="dp-row">{label}<input inputMode="decimal" value={typed[key]} placeholder={placeholder} onChange={(e) => set(key, e.target.value)} /></label>
  );
  const bad = widget.min !== undefined && widget.max !== undefined && widget.min > widget.max;
  return (
    <>
      <div className="dp-pair">
        {box('min', 'Lowest', 'none')}
        {box('max', 'Highest', 'none')}
      </div>
      {box('step', 'Step', '1')}
      {bad && <p className="dp-warn">The lowest value is more than the highest.</p>}
      {field.shift === 'signedNumeric' && (
        <p className="dp-hint">This field's decimals are implied: count in the units typed (1250 for 12.50, so a step of 100 is one whole).</p>
      )}
    </>
  );
}

function TextAreaEditor({ first, draft, setDraft, snap, joining, onJoining }: {
  first: FieldSnapshot; draft: ScreenDefinition; setDraft: (d: ScreenDefinition) => void; snap: ScreenSnapshot;
  joining: boolean; onJoining: (on: boolean) => void;
}) {
  const widget = widgetOf(draft, first.id);
  if (widget?.type !== 'textarea') return null;
  const below = fieldsBelow(draft, snap, first.id);
  const fieldOf = (id: string) => snap.fields.find((f) => f.id === id);
  const room = widget.fields.reduce((n, id) => n + (fieldOf(id)?.length ?? 0), 0);
  return (
    <>
      <p className="dp-hint">The fields are edited as one box, a line each, in this order. Text wraps from one line to the next.</p>
      <ul className="dp-list" aria-label="Text area lines">
        {widget.fields.map((id, i) => (
          <li key={id}>
            <span>Line {i + 1}</span>
            <code>{id}</code>
            <span className="dp-quote">{fieldOf(id)?.length ?? '?'} characters{fieldOf(id) ? '' : ', not on this screen'}</span>
            {i > 0 && (
              <button type="button" className="dp-x" aria-label={`Take out ${id}`} onClick={() => setDraft(toggleTextAreaField(draft, first.id, id))}>×</button>
            )}
          </li>
        ))}
      </ul>
      <p className="dp-hint">Room for {room} characters.</p>
      <div className="dp-actions">
        <button type="button" className="ghost" disabled={below.length === 0}
          title="The input fields in the same column, of the same length, on the rows below"
          onClick={() => setDraft(below.reduce((d, id) => toggleTextAreaField(d, first.id, id), draft))}>
          Add the fields below{below.length > 0 ? ` (${below.length})` : ''}
        </button>
        <button type="button" className={joining ? 'primary' : 'ghost'} aria-pressed={joining} onClick={() => onJoining(!joining)}>
          {joining ? 'Done picking' : 'Pick fields on the screen'}
        </button>
      </div>
      {joining && <p className="dp-hint" role="status">Click fields on the screen to add them, or click a line again to take it out.</p>}
    </>
  );
}

/** For a field that is a line of a text area, other than its first. */
export function TextAreaPart({ first, field, draft, setDraft, onSelect }: {
  first: string; field: string; draft: ScreenDefinition; setDraft: (d: ScreenDefinition) => void; onSelect: (id: string) => void;
}) {
  return (
    <>
      <p className="dp-hint">A line of the text area at <code>{first}</code>, drawn as part of that box.</p>
      <div className="dp-actions">
        <button type="button" className="ghost" onClick={() => onSelect(first)}>Select the text area</button>
        <button type="button" className="ghost" onClick={() => setDraft(toggleTextAreaField(draft, first, field))}>Take it out</button>
      </div>
    </>
  );
}
