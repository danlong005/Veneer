import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createServer, type VeneerServer } from '../src/server.ts';

let server: VeneerServer;
let base: string;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veneer-components-'));
const dir = path.join(root, 'components');

before(async () => {
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'bar-chart.js'), 'export function mount() {}\n');
  fs.writeFileSync(path.join(dir, 'Bad Name.js'), 'export function mount() {}\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a component');
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.writeFileSync(path.join(dir, 'lib', 'util.js'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(dir, '.secret.js'), 'hidden');
  fs.writeFileSync(path.join(root, 'outside.js'), 'outside');
  server = createServer({
    listenHost: '127.0.0.1', listenPort: 0, host: { host: '127.0.0.1', port: 1, tls: false },
    idleTimeoutMs: 0, resumeGraceMs: 0, maxSessions: 1, allowedOrigins: [],
    screensDir: fs.mkdtempSync(path.join(os.tmpdir(), 'veneer-screens-')), componentsDir: dir,
  });
  base = `http://127.0.0.1:${(await server.listen()).port}`;
});

after(async () => {
  await server.close();
  fs.rmSync(root, { recursive: true });
});

test('lists the components: top-level .js files with valid names, versioned', async () => {
  const { components } = await (await fetch(`${base}/api/components`)).json();
  assert.deepEqual(components.map((c: { name: string }) => c.name), ['bar-chart']);
  assert.match(components[0].version, /^[0-9a-z]+-[0-9a-z]+$/);
});

test('serves component files as JavaScript, and nothing outside the folder', async () => {
  const res = await fetch(`${base}/components/bar-chart.js?v=1`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/javascript/);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  assert.equal(await res.text(), 'export function mount() {}\n');
  assert.equal((await fetch(`${base}/components/lib/util.js`)).status, 200, 'a file a component imports');
  for (const p of ['missing.js', '.secret.js', '..%2Foutside.js', '%2e%2e/outside.js', 'lib/', '']) {
    assert.equal((await fetch(`${base}/components/${p}`)).status, 404, p);
  }
});

test('no components folder: none listed', async () => {
  const s = createServer({
    listenHost: '127.0.0.1', listenPort: 0, host: { host: '127.0.0.1', port: 1, tls: false },
    idleTimeoutMs: 0, resumeGraceMs: 0, maxSessions: 1, allowedOrigins: [],
    screensDir: dir, componentsDir: path.join(dir, 'nope'),
  });
  const url = `http://127.0.0.1:${(await s.listen()).port}`;
  assert.deepEqual(await (await fetch(`${url}/api/components`)).json(), { components: [] });
  assert.equal((await fetch(`${url}/components/bar-chart.js`)).status, 404);
  await s.close();
});
