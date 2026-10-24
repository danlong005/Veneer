import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';
import type { ServerConfig } from '../src/config.ts';
import { loadConfig } from '../src/config.ts';
import { log } from '../src/log.ts';
import { createServer, type VeneerServer } from '../src/server.ts';
import { FakeHost } from './fakeHost.ts';

const ADMIN = 'test-admin-token-1';
const DESIGNER = 'test-designer-token';
let host: FakeHost;
let hostPort: number;
const servers: VeneerServer[] = [];

before(async () => {
  host = new FakeHost();
  hostPort = await host.start();
});

after(async () => {
  for (const s of servers) await s.close();
  await host.stop();
});

async function start(extra: Partial<ServerConfig>): Promise<string> {
  const server = createServer({
    listenHost: '127.0.0.1', listenPort: 0,
    host: { host: '127.0.0.1', port: hostPort, tls: false },
    idleTimeoutMs: 0, resumeGraceMs: 0, maxSessions: 5, allowedOrigins: [],
    screensDir: fs.mkdtempSync(path.join(os.tmpdir(), 'veneer-admin-')),
    ...extra,
  });
  servers.push(server);
  return `http://127.0.0.1:${(await server.listen()).port}`;
}

const status = (base: string, token?: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/admin/status`, { headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });

/** Open a browser session and wait for the sign-on screen. */
async function browser(base: string) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  const messages: Array<{ type: string; [k: string]: unknown }> = [];
  ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
  const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ type: 'hello' }));
  const screens = () => messages.filter((m) => m.type === 'screen').length;
  await until(() => screens() > 0);
  return { ws, messages, closed, screens };
}

async function until(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await sleep(10);
  }
}

test('the admin page is off unless configured', async () => {
  const base = await start({ designerToken: DESIGNER, designerLocal: true });
  assert.equal((await status(base)).status, 403);
  assert.equal((await status(base, DESIGNER)).status, 403, 'the designer token is not an admin token');
});

test('the admin token is required and the designer token does not work', async () => {
  const base = await start({ adminToken: ADMIN, designerToken: DESIGNER });
  assert.equal((await status(base)).status, 401);
  assert.equal((await status(base, 'wrong-admin-token')).status, 401);
  assert.equal((await status(base, DESIGNER)).status, 401);
  assert.equal((await status(base, ADMIN)).status, 200);
  const end = await fetch(`${base}/api/admin/sessions/x/end`, { method: 'POST', headers: { Authorization: `Bearer ${DESIGNER}` } });
  assert.equal(end.status, 401);
});

test('local mode opens the page to this machine only', async () => {
  const base = await start({ adminLocal: true });
  assert.equal((await status(base)).status, 200);
  assert.equal((await status(base, undefined, { 'X-Forwarded-For': '203.0.113.9' })).status, 403, 'proxied requests are not local');
  assert.equal((await status(base, undefined, { Origin: 'http://evil.example' })).status, 403, 'other sites are not local');
});

test('lists sessions with the signed-on user, and ends one', async () => {
  const base = await start({ adminToken: ADMIN });
  const b = await browser(base);
  const list = async () => ((await (await status(base, ADMIN)).json()) as { sessions: Array<Record<string, unknown>> }).sessions;

  let [s] = await list();
  assert.equal(s!.user, null);
  assert.equal(s!.device, 'QPADEV0042', 'read from the sign-on screen');
  assert.equal(s!.attached, true);
  assert.equal(s!.hostConnected, true);
  assert.match(s!.remote as string, /127\.0\.0\.1/);

  b.ws.send(JSON.stringify({ type: 'submit', aid: 'Enter', fields: { '6:53': 'qsecofr', '7:53': 'secret-pw' } }));
  await until(() => b.screens() > 1);
  await sleep(30);
  const res = await status(base, ADMIN);
  const text = await res.text();
  assert.ok(!text.includes('secret-pw'), 'never shows the password');
  [s] = (JSON.parse(text) as { sessions: Array<Record<string, unknown>> }).sessions;
  assert.equal(s!.user, 'QSECOFR');

  assert.equal((await fetch(`${base}/api/admin/sessions/nope/end`, { method: 'POST', headers: { Authorization: `Bearer ${ADMIN}` } })).status, 404);
  const end = await fetch(`${base}/api/admin/sessions/${s!.id}/end`, { method: 'POST', headers: { Authorization: `Bearer ${ADMIN}` } });
  assert.equal(end.status, 204);
  assert.equal(await b.closed, 4005);
  assert.ok(b.messages.some((m) => m.type === 'error' && /administrator/.test(m.message as string)));
  assert.deepEqual(await list(), []);
});

test('shows server info and recent problems, newest first', async () => {
  const base = await start({ adminToken: ADMIN });
  log.warn('first problem', { detail: 1 });
  log.error('second problem');
  log.info('not a problem');
  const body = (await (await status(base, ADMIN)).json()) as {
    server: { version: string; ibmi: { port: number; tls: boolean } };
    problems: Array<{ level: string; msg: string; fields?: Record<string, unknown> }>;
  };
  assert.equal(body.server.ibmi.port, hostPort);
  assert.equal(body.server.ibmi.tls, false);
  assert.ok(body.server.version);
  assert.deepEqual(body.problems.slice(0, 2).map((p) => [p.level, p.msg]), [['error', 'second problem'], ['warn', 'first problem']]);
  assert.deepEqual(body.problems[1]!.fields, { detail: 1 });
});

test('configuration checks the admin settings', () => {
  const env = { VENEER_HOST: 'ibmi.example.com' };
  assert.throws(() => loadConfig({ ...env, VENEER_ADMIN_TOKEN: 'short' }), /at least 12/);
  assert.throws(() => loadConfig({ ...env, VENEER_ADMIN_TOKEN: DESIGNER, VENEER_DESIGNER_TOKEN: DESIGNER }), /differ/);
  assert.throws(() => loadConfig({ ...env, VENEER_ADMIN: 'yes' }), /"local"/);
  const c = loadConfig({ ...env, VENEER_ADMIN: 'local', VENEER_ADMIN_TOKEN: ADMIN });
  assert.equal(c.adminLocal, true);
  assert.equal(c.adminToken, ADMIN);
});
