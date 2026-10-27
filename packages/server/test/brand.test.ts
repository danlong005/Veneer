import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { brandFromEnv } from '../src/brand.ts';
import { createServer, type VeneerServer } from '../src/server.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veneer-brand-'));
const svg = path.join(dir, 'logo.svg');
fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');

test('reads the brand settings', () => {
  assert.deepEqual(brandFromEnv({}), {});
  const brand = brandFromEnv({ VENEER_BRAND_NAME: ' Acme Orders ', VENEER_BRAND_ACCENT: '#0A7F5A', VENEER_BRAND_ACCENT_DARK: '#5d5', VENEER_BRAND_LOGO: svg });
  assert.equal(brand.name, 'Acme Orders');
  assert.equal(brand.accent, '#0A7F5A');
  assert.equal(brand.accentDark, '#5d5');
  assert.equal(brand.logo?.type, 'image/svg+xml');
});

test('rejects settings that would not work', () => {
  assert.throws(() => brandFromEnv({ VENEER_BRAND_ACCENT: 'red' }), /VENEER_BRAND_ACCENT must be a hex color/);
  assert.throws(() => brandFromEnv({ VENEER_BRAND_ACCENT: '#123; } body { display: none' }), /hex color/);
  assert.throws(() => brandFromEnv({ VENEER_BRAND_NAME: 'x'.repeat(61) }), /at most 60/);
  assert.throws(() => brandFromEnv({ VENEER_BRAND_LOGO: path.join(dir, 'logo.bmp') }), /must be \.png/);
  assert.throws(() => brandFromEnv({ VENEER_BRAND_LOGO: path.join(dir, 'missing.png') }), /Cannot read/);
});

let server: VeneerServer;
let base: string;

before(async () => {
  server = createServer({
    listenHost: '127.0.0.1', listenPort: 0,
    host: { host: '127.0.0.1', port: 1, tls: false },
    idleTimeoutMs: 0, resumeGraceMs: 0, maxSessions: 1, allowedOrigins: [],
    screensDir: dir,
    brand: brandFromEnv({ VENEER_BRAND_NAME: 'Acme Orders', VENEER_BRAND_ACCENT: '#0a7f5a', VENEER_BRAND_LOGO: svg }),
  });
  base = `http://127.0.0.1:${(await server.listen()).port}`;
});

after(() => server.close());

test('serves the brand to the client and the logo, sandboxed', async () => {
  const config = await (await fetch(`${base}/api/config`)).json();
  assert.deepEqual(config.brand, { name: 'Acme Orders', logo: '/brand/logo', accent: '#0a7f5a', accentDark: null });
  const logo = await fetch(`${base}/brand/logo`);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/svg+xml');
  assert.match(logo.headers.get('content-security-policy') ?? '', /sandbox/);
  assert.match(await logo.text(), /<svg/);
});
