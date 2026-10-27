// The Site-wide tab's Style section: the base look and the options that
// override it (SiteStyle), saved for every user as global.style.json.

import { CORNERS, DENSITIES, FONTS, LOOKS, type SiteStyle } from '@veneer/screens';
import { LOOK_LABELS } from '../ui/looks.ts';

const CORNER_LABELS: Record<(typeof CORNERS)[number], string> = { square: 'Square', round: 'Round' };
const DENSITY_LABELS: Record<(typeof DENSITIES)[number], string> = { compact: 'Compact', normal: 'Normal', roomy: 'Roomy' };
const FONT_LABELS: Record<(typeof FONTS)[number], string> = { sans: 'Sans-serif', mono: 'Monospace' };

export function StyleSection({ style, onChange }: { style: SiteStyle; onChange: (style: SiteStyle) => void }) {
  // Unset options are left out, so they follow the look.
  const set = (key: keyof SiteStyle, value: string) => {
    const next: Record<string, string> = { ...style, [key]: value };
    if (value === '') delete next[key];
    onChange(next as unknown as SiteStyle);
  };
  const option = <T extends string>(key: 'corners' | 'density' | 'font', label: string, values: readonly T[], labels: Record<T, string>) => (
    <label className="dp-row">{label}
      <select value={style[key] ?? ''} onChange={(e) => set(key, e.target.value)}>
        <option value="">From the look</option>
        {values.map((v) => <option key={v} value={v}>{labels[v]}</option>)}
      </select>
    </label>
  );
  return (
    <section>
      <h3>Style</h3>
      <p className="dp-hint">For every user, on every page. The page shows your changes as you make them; saved as global.style.json.</p>
      <label className="dp-row">Look
        <select value={style.look} onChange={(e) => set('look', e.target.value)}>
          {LOOKS.map((l) => <option key={l} value={l}>{LOOK_LABELS[l]}</option>)}
        </select>
      </label>
      <div className="dp-row">
        <span>Accent</span>
        <span className="dp-accent">
          <input type="color" aria-label="Accent color" value={style.accent ?? '#2563eb'} onChange={(e) => set('accent', e.target.value)} />
          {style.accent
            ? <button type="button" className="ghost" onClick={() => set('accent', '')}>Use default</button>
            : <span className="dp-hint">Default (the server's brand color)</span>}
        </span>
      </div>
      {option('corners', 'Corners', CORNERS, CORNER_LABELS)}
      {option('density', 'Density', DENSITIES, DENSITY_LABELS)}
      {option('font', 'Font', FONTS, FONT_LABELS)}
    </section>
  );
}
