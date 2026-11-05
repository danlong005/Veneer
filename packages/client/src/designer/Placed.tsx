// The designer's labels and images: the Page tab's list with Add buttons,
// and the Selected tab's settings for one.

import {
  IMAGE_FITS, LABEL_STYLES, ROLES, THEME_FILE, imageSourceKind, imageUrl,
  type ActiveTheme, type ImageFit, type LabelStyle, type Role, type ScreenDefinition, type Target, themeBase,
} from '@veneer/screens';
import type { ScreenSnapshot } from '@veneer/terminal';
import { useEffect, useState } from 'react';
import { ROLE_LABELS, freeSpot, labelsOf, setPlaced, type ImageSpec, type LabelSpec } from './edit.ts';
import { Section } from './Section.tsx';
import type { themeApi } from './themes.ts';

export const LABEL_STYLE_LABELS: Record<LabelStyle, string> = { text: 'Text', heading: 'Heading', subheading: 'Subheading', note: 'Note (small)' };
const FIT_LABELS: Record<ImageFit, string> = { contain: 'Whole picture (fit inside)', cover: 'Fill the box (crop)' };

type Themes = ReturnType<typeof themeApi>;

/** The Page tab's section: labels and images on this screen, and buttons to add them. */
export function LabelsSection({ draft, setDraft, snap, onSelect }: {
  draft: ScreenDefinition; setDraft: (d: ScreenDefinition) => void; snap: ScreenSnapshot; onSelect: (at: Target) => void;
}) {
  const placed = labelsOf(draft);
  const add = (spec: LabelSpec | ImageSpec) => {
    setDraft(setPlaced(draft, spec.at, spec));
    onSelect(spec.at);
  };
  return (
    <Section title="Labels and images" count={placed.length}>
      {placed.length > 0 && (
        <ul className="dp-list">
          {placed.map((p) => (
            <li key={`${p.at.row}:${p.at.col}`}>
              <code>{p.at.row},{p.at.col}</code>
              <button type="button" className="dp-link dp-quote" onClick={() => onSelect(p.at)} title="Edit it">
                {p.op === 'label' ? `“${p.text}”` : `Image ${p.alt || p.src}`}
              </button>
              <button type="button" className="dp-x" aria-label={p.op === 'label' ? 'Remove label' : 'Remove image'}
                onClick={() => setDraft(setPlaced(draft, p.at, null))}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="dp-actions">
        <button type="button" className="ghost" onClick={() => add({ at: freeSpot(snap, draft, 1), text: 'New label' })}>Add label</button>
        <button type="button" className="ghost" onClick={() => {
          const at = freeSpot(snap, draft, 4);
          add({ at, src: 'logo.png', alt: '', width: 12, height: 4 });
        }}>Add image</button>
      </div>
      <p className="dp-hint">Or click an empty spot on the screen to add one there.</p>
    </Section>
  );
}

export function LabelEditor({ draft, setDraft, label, cols, rows, onSelect }: {
  draft: ScreenDefinition; setDraft: (d: ScreenDefinition) => void; label: LabelSpec; cols: number; rows: number; onSelect: (at: Target) => void;
}) {
  const update = (next: Partial<LabelSpec>) => {
    const merged: LabelSpec = { ...label, ...next };
    if (!merged.help) delete merged.help;
    if (merged.style === 'text') delete merged.style;
    if (merged.role === 'normal') delete merged.role;
    setDraft(setPlaced(draft, label.at, merged));
    if (next.at) onSelect(next.at);
  };
  return (
    <>
      <p className="dp-desc">Label at <code>{label.at.row},{label.at.col}</code></p>
      <label className="dp-row">Text
        <input value={label.text} aria-invalid={label.text.trim() === ''} maxLength={132} onChange={(e) => update({ text: e.target.value })} />
      </label>
      <div className="dp-pair">
        <label className="dp-row">Style
          <select value={label.style ?? 'text'} onChange={(e) => update({ style: e.target.value as LabelStyle })}>
            {LABEL_STYLES.map((s) => <option key={s} value={s}>{LABEL_STYLE_LABELS[s]}</option>)}
          </select>
        </label>
        <label className="dp-row">Color
          <select value={label.role ?? 'normal'} onChange={(e) => update({ role: e.target.value as Role })}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </label>
      </div>
      <label className="dp-row">Help, shown from an ⓘ after the text
        <textarea rows={3} value={label.help ?? ''} maxLength={500} placeholder="none" onChange={(e) => update({ help: e.target.value })} />
      </label>
      {label.text.trim() === '' && <p className="dp-warn">A label needs some text.</p>}
      <Position at={label.at} cols={cols} rows={rows} onChange={(at) => update({ at })} />
      <button type="button" className="ghost danger" onClick={() => setDraft(setPlaced(draft, label.at, null))}>Remove label</button>
    </>
  );
}

export function ImageEditor({ draft, setDraft, image, cols, rows, onSelect, snap, theme, themes }: {
  draft: ScreenDefinition; setDraft: (d: ScreenDefinition) => void; image: ImageSpec; cols: number; rows: number; onSelect: (at: Target) => void;
  snap: ScreenSnapshot; theme: ActiveTheme | null; themes: Themes;
}) {
  const update = (next: Partial<ImageSpec>) => {
    const merged: ImageSpec = { ...image, ...next };
    if (merged.fit === 'contain') delete merged.fit;
    setDraft(setPlaced(draft, image.at, merged));
    if (next.at) onSelect(next.at);
  };
  // The theme's images, to pick from.
  const [files, setFiles] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    if (!theme) { setFiles([]); return; }
    themes.get(theme.name).then((t) => { if (live) setFiles(t.files.map((f) => f.name).filter((f) => THEME_FILE.test(f))); }, () => { if (live) setFiles([]); });
    return () => { live = false; };
  }, [theme, themes]);
  const kind = imageSourceKind(image.src, THEME_FILE);
  const fromTheme = kind === 'theme';
  const url = imageUrl(image.src, snap, THEME_FILE, theme ? themeBase(theme.name) : undefined);
  const num = (value: string, max: number) => Math.min(max, Math.max(1, Math.trunc(Number(value)) || 1));
  return (
    <>
      <p className="dp-desc">Image at <code>{image.at.row},{image.at.col}</code></p>
      <label className="dp-row">Picture
        <select value={fromTheme ? image.src : ''} onChange={(e) => update({ src: e.target.value || 'https://' })}>
          {files?.map((f) => <option key={f} value={f}>{f}, from the theme</option>)}
          {fromTheme && files && !files.includes(image.src) && <option value={image.src}>{image.src} (not in the theme in use)</option>}
          <option value="">A web address or site path</option>
        </select>
      </label>
      {!fromTheme && (
        <label className="dp-row">Address
          <input value={image.src} spellCheck={false} aria-invalid={!kind} placeholder="https://example.com/photos/{6:12}.jpg or /images/{6:12}.png"
            onChange={(e) => update({ src: e.target.value })} />
        </label>
      )}
      <p className="dp-preview">
        {!kind ? 'Needs an image of the theme, an http(s) address or a path on this site starting with /.'
          : fromTheme ? `The theme's own image. Add images on the Themes tab (Artwork).`
          : <>Loads {url ?? '(the address can’t be made from this screen)'}. {'{row:col}'} takes the text or field there.</>}
      </p>
      <label className="dp-row">Description, for people who can't see it
        <input value={image.alt} maxLength={200} placeholder="none: a decoration" onChange={(e) => update({ alt: e.target.value })} />
      </label>
      <label className="dp-row">Fit
        <select value={image.fit ?? 'contain'} onChange={(e) => update({ fit: e.target.value as ImageFit })}>
          {IMAGE_FITS.map((f) => <option key={f} value={f}>{FIT_LABELS[f]}</option>)}
        </select>
      </label>
      <Position at={image.at} cols={cols} rows={rows} onChange={(at) => update({ at })} />
      <div className="dp-pair">
        <label className="dp-row">Width (columns)<input type="number" min={1} max={cols} value={image.width}
          onChange={(e) => update({ width: num(e.target.value, cols) })} /></label>
        <label className="dp-row">Height (rows)<input type="number" min={1} max={rows} value={image.height}
          onChange={(e) => update({ height: num(e.target.value, rows) })} /></label>
      </div>
      <p className="dp-hint">Drag it to move it, or its corner to resize it.</p>
      <button type="button" className="ghost danger" onClick={() => setDraft(setPlaced(draft, image.at, null))}>Remove image</button>
    </>
  );
}

function Position({ at, cols, rows, onChange }: { at: Target; cols: number; rows: number; onChange: (at: Target) => void }) {
  const num = (value: string, max: number) => Math.min(max, Math.max(1, Math.trunc(Number(value)) || 1));
  return (
    <div className="dp-pair">
      <label className="dp-row">Row<input type="number" min={1} max={rows} value={at.row} onChange={(e) => onChange({ ...at, row: num(e.target.value, rows) })} /></label>
      <label className="dp-row">Column<input type="number" min={1} max={cols} value={at.col} onChange={(e) => onChange({ ...at, col: num(e.target.value, cols) })} /></label>
    </div>
  );
}
