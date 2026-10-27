// Branding: product name, logo and accent colors from VENEER_BRAND_* settings,
// served to the client in /api/config and at /brand/logo.

import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';

export interface Brand {
  name?: string;
  logo?: { data: Buffer; type: string };
  /** Accent color (#rgb or #rrggbb); dark mode lightens it unless accentDark is set. */
  accent?: string;
  accentDark?: string;
}

/** What the client gets in /api/config. */
export interface BrandInfo {
  name: string | null;
  logo: string | null;
  accent: string | null;
  accentDark: string | null;
}

export const LOGO_PATH = '/brand/logo';
const LOGO_TYPES: Record<string, string> = {
  '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
};
const MAX_LOGO_BYTES = 1024 * 1024;
const MAX_NAME = 60;

/** Read the brand settings. Throws on a bad color, a long name or an unusable logo file. */
export function brandFromEnv(env: NodeJS.ProcessEnv): Brand {
  const brand: Brand = {};
  const name = env.VENEER_BRAND_NAME?.trim();
  if (name) {
    if (name.length > MAX_NAME) throw new Error(`VENEER_BRAND_NAME must be at most ${MAX_NAME} characters`);
    brand.name = name;
  }
  for (const [key, setting] of [['accent', 'VENEER_BRAND_ACCENT'], ['accentDark', 'VENEER_BRAND_ACCENT_DARK']] as const) {
    const value = env[setting]?.trim();
    if (!value) continue;
    // Only hex: the value goes into the page's CSS.
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) throw new Error(`${setting} must be a hex color such as #0a7f5a, got "${value}"`);
    brand[key] = value;
  }
  const file = env.VENEER_BRAND_LOGO?.trim();
  if (file) {
    const type = LOGO_TYPES[path.extname(file).toLowerCase()];
    if (!type) throw new Error(`VENEER_BRAND_LOGO must be ${Object.keys(LOGO_TYPES).join(', ')}, got "${file}"`);
    let data: Buffer;
    try { data = fs.readFileSync(file); } catch (err) { throw new Error(`Cannot read VENEER_BRAND_LOGO "${file}": ${(err as Error).message}`); }
    if (data.length > MAX_LOGO_BYTES) throw new Error(`VENEER_BRAND_LOGO must be at most 1 MB, "${file}" is ${data.length} bytes`);
    brand.logo = { data, type };
  }
  return brand;
}

export function brandInfo(brand: Brand): BrandInfo {
  return {
    name: brand.name ?? null,
    logo: brand.logo ? LOGO_PATH : null,
    accent: brand.accent ?? null,
    accentDark: brand.accentDark ?? null,
  };
}

/** GET /brand/logo. An SVG logo is shown as an image; opened directly, its scripts do not run. */
export function serveLogo(brand: Brand, req: http.IncomingMessage, res: http.ServerResponse): void {
  if (!brand.logo) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('No logo configured (VENEER_BRAND_LOGO)');
    return;
  }
  res.writeHead(200, {
    'Content-Type': brand.logo.type,
    'Content-Length': brand.logo.data.length,
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  });
  res.end(req.method === 'HEAD' ? undefined : brand.logo.data);
}
