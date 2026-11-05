// The designer's "Show as" for output text: a status badge, a formatted
// number or date, yes or no, a link, a progress bar or a barcode, for the
// selected text or for a column of a list.

import {
  BARCODE_FORMATS, DATE_FORMATS, DATE_STYLES, LINK_KINDS, ROLES, fillLink,
  type BadgeValue, type DateFormat, type DateStyle, type Display, type LinkKind, type Role, type ScreenDefinition, type Target,
} from '@veneer/screens';
import type { ScreenSnapshot } from '@veneer/terminal';
import { useState } from 'react';
import type { TableItem } from '../transform/types.ts';
import { formatDate, formatNumber } from '../ui/display.ts';
import { DISPLAY_CHOICES, defaultDisplay } from './defaults.ts';
import { ROLE_LABELS, displayOf, setDisplay } from './edit.ts';

const STYLE_LABELS: Record<DateStyle, string> = { short: 'Short (3/4/26)', medium: 'Medium (Mar 4, 2026)', long: 'Long (March 4, 2026)' };
const LINK_LABELS: Record<LinkKind, string> = { email: 'Email address', phone: 'Phone number', url: 'Web address' };

/** "Show as" for the selected text, and the display's settings. */
export function TextDisplay({ draft, setDraft, at, text, snap }: {
  draft: ScreenDefinition; setDraft: (d: ScreenDefinition) => void; at: Target; text: string; snap: ScreenSnapshot;
}) {
  const display = displayOf(draft, { at });
  return (
    <>
      <label className="dp-row">Show as
        <select value={display?.type ?? 'text'} onChange={(e) => setDraft(setDisplay(draft, { at }, defaultDisplay(e.target.value, text)))}>
          <option value="text">Text</option>
          {DISPLAY_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </label>
      {display && (
        <DisplayEditor key={display.type} display={display} sample={text} snap={snap} onChange={(d) => setDraft(setDisplay(draft, { at }, d))} />
      )}
    </>
  );
}

/** For a list: how each column's cells show. Cells with input fields keep their field. */
export function ColumnDisplays({ draft, setDraft, table, snap }: {
  draft: ScreenDefinition; setDraft: (d: ScreenDefinition) => void; table: TableItem; snap: ScreenSnapshot;
}) {
  // Columns with a heading and some output text: input fields keep their own widgets.
  const columns = table.columns.filter((c, k) => c.header.trim() !== '' && table.rows.some((r) => r.cells[k] && !r.cells[k]!.field));
  const [picked, setPicked] = useState(columns[0]?.header.trim() ?? '');
  if (columns.length === 0) return <p className="dp-hint">This list has no columns of text with headings to show differently.</p>;
  const column = columns.find((c) => c.header.trim() === picked) ?? columns[0]!;
  const heading = column.header.trim();
  const display = displayOf(draft, { column: heading });
  const k = table.columns.indexOf(column);
  const sample = table.rows.map((r) => r.cells[k]).find((c) => c && !c.field && c.text.trim())?.text ?? '';
  const shown = columns.filter((c) => displayOf(draft, { column: c.header.trim() }));
  return (
    <>
      <label className="dp-row">Column
        <select value={heading} onChange={(e) => setPicked(e.target.value)}>
          {columns.map((c) => (
            <option key={c.col} value={c.header.trim()}>{displayOf(draft, { column: c.header.trim() }) ? '● ' : ''}{c.header.trim()}</option>
          ))}
        </select>
      </label>
      <label className="dp-row">Show its cells as
        <select value={display?.type ?? 'text'} onChange={(e) => setDraft(setDisplay(draft, { column: heading }, defaultDisplay(e.target.value, sample)))}>
          <option value="text">Text</option>
          {DISPLAY_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </label>
      {display && (
        <DisplayEditor key={`${heading}:${display.type}`} display={display} sample={sample} snap={snap}
          onChange={(d) => setDraft(setDisplay(draft, { column: heading }, d))} />
      )}
      {shown.length > 0 && <p className="dp-hint">Shown differently: {shown.map((c) => c.header.trim()).join(', ')} (marked ●).</p>}
    </>
  );
}

/** A number box's value: blank for none. */
const intOf = (text: string, min: number, max: number): number | undefined => {
  const n = Math.trunc(Number(text));
  return text.trim() === '' || !Number.isFinite(n) ? undefined : Math.min(max, Math.max(min, n));
};

export function DisplayEditor({ display, sample, snap, onChange }: {
  display: Display; sample: string; snap: ScreenSnapshot; onChange: (d: Display) => void;
}) {
  switch (display.type) {
    case 'badge':
      return <BadgeEditor display={display} onChange={onChange} />;
    case 'number': {
      const set = (key: 'implied' | 'decimals', text: string) => {
        const { [key]: _omit, ...rest } = display;
        const n = intOf(text, 0, 9);
        onChange(n === undefined ? rest : { ...rest, [key]: n });
      };
      const preview = sample.trim() ? formatNumber(sample, display) : undefined;
      return (
        <>
          <div className="dp-pair">
            <label className="dp-row">Implied decimals
              <input inputMode="numeric" value={display.implied ?? ''} placeholder="none" onChange={(e) => set('implied', e.target.value)} />
            </label>
            <label className="dp-row">Decimals shown
              <input inputMode="numeric" value={display.decimals ?? ''} placeholder="as sent" onChange={(e) => set('decimals', e.target.value)} />
            </label>
          </div>
          <label className="dp-row">Currency code
            <input value={display.currency ?? ''} placeholder="none, or USD, EUR…" maxLength={3} onChange={(e) => {
              const { currency: _omit, ...rest } = display;
              const code = e.target.value.toUpperCase();
              onChange(code ? { ...rest, currency: code } : rest);
            }} />
          </label>
          <p className="dp-hint">Implied decimals: for a host value such as 1250 meaning 12.50 (used only when the text has no decimal point).</p>
          {sample.trim() && <p className="dp-preview">“{sample.trim()}” shows as {preview ? <strong>{preview}</strong> : 'itself (not a number, or not a currency code the browser knows)'}</p>}
        </>
      );
    }
    case 'date': {
      const preview = sample.trim() ? formatDate(sample, display) : undefined;
      return (
        <>
          <label className="dp-row">Host date format
            <select value={display.format} onChange={(e) => onChange({ ...display, format: e.target.value as DateFormat })}>
              {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="dp-row">Shown as
            <select value={display.style ?? 'medium'} onChange={(e) => onChange({ ...display, style: e.target.value as DateStyle })}>
              {DATE_STYLES.map((s) => <option key={s} value={s}>{STYLE_LABELS[s]}</option>)}
            </select>
          </label>
          {sample.trim() && <p className="dp-preview">“{sample.trim()}” shows as {preview ? <strong>{preview}</strong> : 'itself (not a date in this format)'}</p>}
          {preview && preview.length > sample.trim().length && (
            <p className="dp-hint">That is wider than the host's text: it can run into what is to its right. Pick a shorter style, or move what is there.</p>
          )}
        </>
      );
    }
    case 'yesno':
      return (
        <div className="dp-pair">
          <label className="dp-row">Yes value<input value={display.yes} onChange={(e) => onChange({ ...display, yes: e.target.value })} /></label>
          <label className="dp-row">No value<input value={display.no} onChange={(e) => onChange({ ...display, no: e.target.value })} /></label>
        </div>
      );
    case 'link': {
      const preview = display.to === 'url' && display.url ? fillLink(display.url, sample, snap) : undefined;
      return (
        <>
          <label className="dp-row">Links to
            <select value={display.to} onChange={(e) => onChange({ type: 'link', to: e.target.value as LinkKind })}>
              {LINK_KINDS.map((k) => <option key={k} value={k}>{LINK_LABELS[k]}</option>)}
            </select>
          </label>
          {display.to === 'url' && (
            <>
              <label className="dp-row">Address
                <input value={display.url ?? ''} spellCheck={false} placeholder="the text itself, or https://example.com/orders/{value}"
                  onChange={(e) => onChange(e.target.value ? { ...display, url: e.target.value } : { type: 'link', to: 'url' })} />
              </label>
              <p className="dp-preview">
                {display.url
                  ? preview ? <>Opens <a href={preview} target="_blank" rel="noopener noreferrer">{preview}</a></> : 'Needs http:// or https:// and a host name.'
                  : 'Blank: the text must be a web address itself.'}
                {' '}{'{value}'} is the text; {'{row:col}'} other text on the screen.
              </p>
            </>
          )}
        </>
      );
    }
    case 'progress':
      return <ProgressEditor display={display} onChange={onChange} />;
    case 'barcode':
      return (
        <>
          <div className="dp-pair">
            <label className="dp-row">Kind
              <select value={display.format} onChange={(e) => onChange({ ...display, format: e.target.value as 'qr' | 'code128' })}>
                {BARCODE_FORMATS.map((f) => <option key={f} value={f}>{f === 'qr' ? 'QR code' : 'Code 128'}</option>)}
              </select>
            </label>
            <label className="dp-row">Height (rows)
              <input type="number" min={1} max={20} value={display.height}
                onChange={(e) => onChange({ ...display, height: intOf(e.target.value, 1, 20) ?? 1 })} />
            </label>
          </div>
          <p className="dp-hint">It covers the rows below the text: leave room, or move what is there.{display.format === 'code128' ? ' Code 128 takes letters, digits and ASCII symbols.' : ''}</p>
        </>
      );
  }
}

function BadgeEditor({ display, onChange }: { display: Extract<Display, { type: 'badge' }>; onChange: (d: Display) => void }) {
  const set = (values: BadgeValue[]) => onChange({ ...display, values });
  const put = (i: number, next: BadgeValue) => set(display.values.map((v, j) => (j === i ? next : v)));
  return (
    <>
      <p className="dp-hint">Each value the host sends, what it shows as, and its color. Other values show as they are.</p>
      {display.values.map((v, i) => (
        <div className="dp-badge" key={i}>
          <input value={v.value} aria-label="Value" placeholder="Value" onChange={(e) => put(i, { ...v, value: e.target.value })} />
          <input value={v.label ?? ''} aria-label="Shown as" placeholder={v.value || 'Shown as'} onChange={(e) => {
            const { label: _omit, ...rest } = v;
            put(i, e.target.value ? { ...rest, label: e.target.value } : rest);
          }} />
          <select value={v.role} aria-label="Color" onChange={(e) => put(i, { ...v, role: e.target.value as Role })}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          <button type="button" className="dp-x" aria-label={`Remove ${v.value || 'value'}`} onClick={() => set(display.values.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="ghost" onClick={() => set([...display.values, { value: '', role: 'accent' }])}>Add value</button>
      <label className="dp-row">Other values
        <select value={display.otherwise ?? ''} onChange={(e) => {
          const { otherwise: _omit, ...rest } = display;
          onChange(e.target.value ? { ...rest, otherwise: e.target.value as Role } : rest);
        }}>
          <option value="">As text</option>
          {ROLES.map((r) => <option key={r} value={r}>As text, {ROLE_LABELS[r]}</option>)}
        </select>
      </label>
    </>
  );
}

function ProgressEditor({ display, onChange }: { display: Extract<Display, { type: 'progress' }>; onChange: (d: Display) => void }) {
  // As typed, so the box can be cleared to type another number.
  const [typed, setTyped] = useState(String(display.max));
  const n = Number(typed);
  const valid = typed.trim() !== '' && Number.isFinite(n) && n > 0;
  return (
    <>
      <label className="dp-row">Full at
        <input inputMode="decimal" value={typed} aria-invalid={!valid} onChange={(e) => {
          setTyped(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(v) && v > 0) onChange({ ...display, max: v });
        }} />
      </label>
      <p className="dp-hint">The number that fills the bar, such as 100 for a percentage.</p>
    </>
  );
}
