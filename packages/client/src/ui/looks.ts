// The site's style (SiteStyle, chosen in the designer): a base look from
// ui/looks.css plus options, set as data attributes on <html>, and an accent
// color that overrides the server's VENEER_BRAND_ACCENT.

import type { Look, SiteStyle } from '@veneer/screens';

export const LOOK_LABELS: Record<Look, string> = {
  default: 'Default',
  compact: 'Compact',
  flat: 'Flat',
  green: 'Green screen',
  soft: 'Soft',
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Show the page in `style`: the saved one, or the designer's draft while it is open. */
export function applyStyle(style: SiteStyle | undefined): void {
  const root = document.documentElement;
  const set = (name: 'look' | 'corners' | 'density' | 'font', value: string | undefined) => {
    if (value && value !== 'default') root.dataset[name] = value;
    else delete root.dataset[name];
  };
  set('look', style?.look);
  set('corners', style?.corners);
  set('density', style?.density);
  set('font', style?.font);

  let el = document.head.querySelector<HTMLStyleElement>('style[data-veneer-style]');
  const accent = style?.accent && HEX.test(style.accent) ? style.accent : null;
  if (!accent) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('style');
    el.dataset.veneerStyle = '';
    // After the brand colors (ui/brand.ts), so the designer's accent wins.
    document.head.append(el);
  }
  el.textContent = `:root { --brand-accent: ${accent}; }`;
}
