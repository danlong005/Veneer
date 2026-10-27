// Branding from the server (VENEER_BRAND_*, in /api/config): the product name
// and logo in the header, the page title and favicon, and the accent color
// (--brand-accent, which the stylesheet's accent tints follow).

import { useEffect, useState } from 'react';

export interface Brand {
  name: string;
  logo: string;
}

interface BrandInfo {
  name: string | null;
  logo: string | null;
  accent: string | null;
  accentDark: string | null;
}

export const DEFAULT_BRAND: Brand = { name: 'Veneer', logo: '/veneer-mark.png' };
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

let loading: Promise<Brand> | null = null;

function load(): Promise<Brand> {
  loading ??= fetch('/api/config')
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const info = ((await res.json()) as { brand?: BrandInfo }).brand;
      if (info) applyColors(info);
      return { name: info?.name || DEFAULT_BRAND.name, logo: info?.logo || DEFAULT_BRAND.logo };
    })
    .catch((err: Error) => {
      console.warn('Could not load branding:', err.message);
      return DEFAULT_BRAND;
    })
    .then((brand) => {
      document.title = brand.name;
      if (brand.logo !== DEFAULT_BRAND.logo) document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute('href', brand.logo);
      return brand;
    });
  return loading;
}

function applyColors(info: BrandInfo): void {
  const vars = [
    info.accent && HEX.test(info.accent) ? `--brand-accent: ${info.accent};` : '',
    info.accentDark && HEX.test(info.accentDark) ? `--brand-accent-dark: ${info.accentDark};` : '',
  ].join('');
  if (!vars) return;
  const style = document.createElement('style');
  style.dataset.veneerBrand = '';
  style.textContent = `:root { ${vars} }`;
  // First in <head>, so site and screen CSS can still override it.
  document.head.prepend(style);
}

/** The brand, or null until it has loaded (so the default logo does not flash first). */
export function useBrand(): Brand | null {
  const [brand, setBrand] = useState<Brand | null>(null);
  useEffect(() => {
    let live = true;
    void load().then((b) => { if (live) setBrand(b); });
    return () => { live = false; };
  }, []);
  return brand;
}
