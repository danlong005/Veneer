// Automatic sign-on (#25): Veneer's sign-on page, the password substitute
// sent instead of the password, and what the host's answer leads to.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, mock, test } from 'node:test';
import WebSocket from 'ws';
import type { ServerConfig } from '../src/config.ts';
import { log } from '../src/log.ts';
import { createServer, passwordSafe, type VeneerServer } from '../src/server.ts';
import { FakeHost, type FakeSignOn } from './fakeHost.ts';

const USERS: FakeSignOn['users'] = {
  DLONG: { password: 'Secret Phrase 1' },
  GONE: { password: 'whatever', status: 'disabled' },
  OLDPW: { password: 'expired1', status: 'expired' },
};

let host: FakeHost;
let hostPort: number;
const servers: VeneerServer[] = [];
/** Sockets the tests open, closed after each test even when it fails, so the server can close. */
const sockets: WebSocket[] = [];

before(async () => {
  host = new FakeHost();
  hostPort = await host.start();
});

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const s of servers.splice(0)) await s.close();
  host.signOn = undefined;
  mock.restoreAll();
});

after(() => host.stop());

async function start(signOn: FakeSignOn, extra: Partial<ServerConfig> = {}): Promise<{ url: string; server: VeneerServer }> {
  host.signOn = signOn;
  const server = createServer({
    listenHost: '127.0.0.1', listenPort: 0,
    host: { host: '127.0.0.1', port: hostPort, tls: false, autoSignOn: { substitute: signOn.substitute } },
    idleTimeoutMs: 0, resumeGraceMs: 0, maxSessions: 10, allowedOrigins: [],
    screensDir: fs.mkdtempSync(path.join(os.tmpdir(), 'veneer-signon-')),
    signOnDelayMs: 300,
    ...extra,
  });
  servers.push(server);
  return { url: `ws://127.0.0.1:${(await server.listen()).port}/ws`, server };
}

type Message = { type: string; [k: string]: unknown };

async function browser(url: string, headers: Record<string, string> = {}) {
  const ws = new WebSocket(url, { headers });
  sockets.push(ws);
  const messages: Message[] = [];
  ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ type: 'hello' }));
  const of = (type: string) => messages.filter((m) => m.type === type);
  const screenText = () => ((of('screen').at(-1)?.screen as { lines: string[] } | undefined)?.lines ?? []).join('\n');
  return {
    ws, messages, of, screenText,
    signOn: (user: string, password: string, extra: Record<string, string> = {}) => ws.send(JSON.stringify({ type: 'signon', user, password, ...extra })),
    close: () => ws.close(),
  };
}

async function until(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('a new session shows the sign-on page, and connects to the host only once it is filled in', async () => {
  const { url, server } = await start({ substitute: 'sha', users: USERS });
  const before = host.connections;
  const b = await browser(url);
  await until(() => b.of('signon').length > 0);
  assert.deepEqual(b.of('signon')[0], { type: 'signon', password: { maxLength: 128, caseSensitive: true } });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(host.connections, before, 'no host connection yet');
  assert.equal(server.sessions.list()[0]!.hostConnected, false);

  const info = mock.method(log, 'info');
  b.signOn('dlong', 'Secret Phrase 1', { program: 'qcmd', library: 'mylib' });
  await until(() => b.of('screen').length > 0);
  assert.match(b.screenText(), /IBM i Main Menu/, 'lands past the sign-on screen');
  assert.equal(b.of('screen').at(-1)!.user, 'DLONG');
  assert.deepEqual(host.signedOnUsers, ['DLONG']);
  assert.equal(server.sessions.list()[0]!.user, 'DLONG', 'the admin page knows the user');
  assert.equal(server.sessions.list()[0]!.device, 'QPADEV0042', 'and the device, from the Startup Response Record');

  const env = host.environments.at(-1)!;
  assert.equal(env.USER!.toString(), 'DLONG');
  assert.equal(env.IBMSUBSPW!.length, 20, 'a SHA-1 substitute');
  assert.equal(env.IBMPROGRAM!.toString(), 'QCMD');
  assert.equal(env.IBMCURLIB!.toString(), 'MYLIB');
  assert.equal(env.IBMSENDCONFREC!.toString(), 'YES');
  assert.ok(!Object.values(env).some((v) => v.toString('latin1').includes('Secret')), 'the password is not sent');
  const logged = JSON.stringify(info.mock.calls.map((c) => c.arguments));
  assert.match(logged, /"signed on",\{[^}]*"user":"DLONG","automatic":true/);
  assert.ok(!logged.includes('Secret'), 'nor logged');
  b.close();
});

test('DES at password levels 0 and 1: passwords of up to 10 characters, any case', async () => {
  const { url } = await start({ substitute: 'des', users: { DLONG: { password: 'PASSW0RD' } } });
  const b = await browser(url);
  await until(() => b.of('signon').length > 0);
  assert.deepEqual(b.of('signon')[0]!.password, { maxLength: 10, caseSensitive: false });
  b.signOn('DLONG', 'Passw0rd12345');
  await until(() => b.of('signon').length > 1);
  assert.equal(b.of('signon')[1]!.error, 'A password is at most 10 characters on this IBM i.', 'checked before the host');
  b.signOn('DLONG', 'passw0rd');
  await until(() => b.of('screen').length > 0);
  assert.match(b.screenText(), /IBM i Main Menu/);
  assert.equal(host.environments.at(-1)!.IBMSUBSPW!.length, 8, 'a DES substitute');
  b.close();
});

test('a wrong password, an unknown user or a disabled profile: back to the page with the reason', async () => {
  const { url, server } = await start({ substitute: 'sha', users: USERS });
  const b = await browser(url);
  await until(() => b.of('signon').length > 0);
  const tries: Array<[string, string, string]> = [
    ['DLONG', 'secret phrase 1', 'The password is wrong.'],
    ['NOBODY', 'x', 'There is no such user on this IBM i.'],
  ];
  for (const [user, password, error] of tries) {
    const n = b.of('signon').length;
    b.signOn(user, password);
    await until(() => b.of('signon').length > n);
    assert.equal(b.of('signon').at(-1)!.error, error);
    assert.equal(b.of('screen').length, 0, 'no screen shown');
    assert.equal(server.sessions.list()[0]!.hostConnected, false, 'the host connection is closed');
    assert.equal(server.sessions.list()[0]!.user, null);
  }
  b.close();

  // A third failure from the same address waits before it is tried.
  const c = await browser(url);
  await until(() => c.of('signon').length > 0);
  const started = Date.now();
  c.signOn('GONE', 'whatever');
  await until(() => c.of('signon').length > 1);
  assert.equal(c.of('signon').at(-1)!.error, 'Your user profile is disabled. Ask your administrator to enable it.');
  assert.ok(Date.now() - started >= 280, `held back (${Date.now() - started} ms)`);

  c.signOn('DLONG', 'Secret Phrase 1');
  await until(() => c.of('screen').length > 0, 5000);
  assert.match(c.screenText(), /IBM i Main Menu/, 'and the right password still works');
  c.close();
});

test('an expired password goes on to the host sign-on screen, to change it there', async () => {
  const { url } = await start({ substitute: 'sha', users: USERS });
  const b = await browser(url);
  await until(() => b.of('signon').length > 0);
  b.signOn('OLDPW', 'expired1');
  await until(() => b.of('screen').length > 0);
  assert.match(b.screenText(), /Sign On/);
  assert.deepEqual(b.of('notice').map((m) => m.message), ['Your password has expired. Sign on here to change it.']);
  b.close();
});

for (const mode of ['refuse', 'no-seed'] as const) {
  test(`a host that doesn't allow automatic sign-on (${mode}): its own sign-on screen, now and for later sessions`, async () => {
    const warn = mock.method(log, 'warn');
    const { url } = await start({ substitute: 'sha', users: USERS, mode });
    const b = await browser(url);
    const early = await browser(url);
    await until(() => b.of('signon').length > 0 && early.of('signon').length > 0);
    b.signOn('DLONG', 'Secret Phrase 1');
    early.signOn('DLONG', 'Secret Phrase 1');
    await until(() => b.of('screen').length > 0 && early.of('screen').length > 0);
    assert.match(b.screenText(), /Sign On/);
    assert.equal(host.sockets.size, 2, 'the refused connections are closed: one each');
    assert.match(String(b.of('notice')[0]?.message), /doesn't allow automatic sign-on/);
    if (mode === 'no-seed') assert.equal(host.environments.at(-2)!.USER, undefined, 'no seed: the user is not sent');
    const c = await browser(url);
    await until(() => c.of('screen').length > 0);
    assert.equal(c.of('signon').length, 0, 'the next session goes straight to the host');
    const warnings = warn.mock.calls.filter((call) => String(call.arguments[0]).startsWith('automatic sign-on is not allowed'));
    assert.equal(warnings.length, 1, 'logged once');
    assert.match(JSON.stringify(warnings[0]!.arguments), /QRMTSIGN/);
    b.close();
    c.close();
    early.close();
  });
}

test('a host that sends no Startup Response Record: its first screen says how sign-on went', async () => {
  const { url, server } = await start({ substitute: 'sha', users: USERS, mode: 'no-record' });
  const b = await browser(url);
  await until(() => b.of('signon').length > 0);
  b.signOn('DLONG', 'Secret Phrase 1');
  await until(() => b.of('screen').length > 0);
  assert.match(b.screenText(), /IBM i Main Menu/);
  assert.equal(server.sessions.list()[0]!.user, 'DLONG');
  b.close();

  // Its sign-on screen could mean a wrong password: that user signs on there, and automatic sign-on stays on.
  const c = await browser(url);
  await until(() => c.of('signon').length > 0);
  c.signOn('DLONG', 'wrong');
  await until(() => c.of('screen').length > 0);
  assert.match(c.screenText(), /Sign On/);
  assert.deepEqual(c.of('notice').map((m) => m.message), ['Veneer couldn\'t sign you on automatically. Sign on here.']);
  const d = await browser(url);
  await until(() => d.of('signon').length > 0);
  c.close();
  d.close();
});

test('passwords are taken only from pages on HTTPS or this machine', async () => {
  const origin = 'http://veneer.example.com';
  const { url } = await start({ substitute: 'sha', users: USERS }, { allowedOrigins: [origin, 'https://veneer.example.com'] });
  const b = await browser(url, { Origin: origin });
  await until(() => b.of('signon').length > 0);
  b.signOn('DLONG', 'Secret Phrase 1');
  await until(() => b.of('signon').length > 1);
  assert.match(String(b.of('signon')[1]!.error), /only over HTTPS/);
  assert.equal(host.signedOnUsers.length, 0);
  b.close();

  const secure = await browser(url, { Origin: 'https://veneer.example.com' });
  await until(() => secure.of('signon').length > 0);
  secure.signOn('DLONG', 'Secret Phrase 1');
  await until(() => secure.of('screen').length > 0);
  secure.close();
});

test('what counts as a safe page for a password', () => {
  const req = (origin: string | undefined, remoteAddress = '127.0.0.1', encrypted = false) =>
    ({ headers: origin ? { origin } : {}, socket: { remoteAddress, encrypted } }) as never;
  assert.equal(passwordSafe(req('https://veneer.example.com', '10.0.0.5')), true, 'HTTPS, here or at a proxy');
  assert.equal(passwordSafe(req('http://localhost:8080')), true, 'this machine');
  assert.equal(passwordSafe(req('http://[::1]:8080', '::1')), true);
  assert.equal(passwordSafe(req('http://veneer.example.com')), false, 'plain HTTP through a proxy on this machine');
  assert.equal(passwordSafe(req('http://localhost:8080', '10.0.0.5')), false, 'a remote client claiming localhost');
  assert.equal(passwordSafe(req(undefined, '10.0.0.5', true)), true, 'Veneer serves HTTPS itself');
  assert.equal(passwordSafe(req(undefined, '10.0.0.5')), false);
});

test('a page reloaded on the sign-on page gets it again, and signs on in the same session', async () => {
  const { url, server } = await start({ substitute: 'sha', users: USERS }, { resumeGraceMs: 5000 });
  const a = await browser(url);
  await until(() => a.of('hello').length > 0 && a.of('signon').length > 0);
  const token = a.of('hello')[0]!.resumeToken as string;
  a.close();
  const b = new WebSocket(url);
  sockets.push(b);
  const messages: Message[] = [];
  b.on('message', (d) => messages.push(JSON.parse(d.toString())));
  await new Promise((r) => b.once('open', r));
  b.send(JSON.stringify({ type: 'hello', resumeToken: token }));
  await until(() => messages.some((m) => m.type === 'signon'));
  assert.equal(messages.find((m) => m.type === 'hello')!.resumed, true);
  b.send(JSON.stringify({ type: 'signon', user: 'DLONG', password: 'Secret Phrase 1' }));
  await until(() => messages.some((m) => m.type === 'screen'));
  assert.equal(server.sessions.list().length, 1);
  b.close();
});

test('signing off goes back to the sign-on page, letting go of the host connection', async () => {
  const { url, server } = await start({ substitute: 'sha', users: USERS });
  const b = await browser(url);
  await until(() => b.of('signon').length > 0);
  b.signOn('DLONG', 'Secret Phrase 1');
  await until(() => b.of('screen').length > 0);
  const screens = b.of('screen').length;
  b.ws.send(JSON.stringify({ type: 'submit', aid: 'F3' }));
  await until(() => b.of('signon').length > 1);
  assert.equal(b.of('screen').length, screens, "the host's sign-on screen isn't shown");
  assert.equal(server.sessions.list()[0]!.hostConnected, false);
  assert.equal(server.sessions.list()[0]!.user, null);
  await until(() => host.signedOnUsers.length === 0 && server.sessions.list()[0]!.device === null);

  b.signOn('DLONG', 'Secret Phrase 1');
  await until(() => b.of('screen').length > screens);
  assert.match(b.screenText(), /IBM i Main Menu/, 'and signs on again in the same session');
  assert.equal(server.sessions.list().length, 1);
  b.close();
});

test('keys before signing on are refused, and a sign-on is not expected twice', async () => {
  const { url } = await start({ substitute: 'sha', users: USERS });
  const b = await browser(url);
  await until(() => b.of('signon').length > 0);
  b.ws.send(JSON.stringify({ type: 'submit', aid: 'Enter' }));
  await until(() => b.of('error').length > 0);
  assert.equal(b.of('error')[0]!.message, 'Not signed on yet');
  b.signOn('DLONG', 'Secret Phrase 1');
  await until(() => b.of('screen').length > 0);
  b.signOn('DLONG', 'Secret Phrase 1');
  await until(() => b.of('error').length > 1);
  assert.equal(b.of('error')[1]!.message, 'Not expecting a sign-on');
  b.close();
});

test('without VENEER_SIGNON=auto, sessions go straight to the host and sign-on messages are refused', async () => {
  host.signOn = undefined;
  const server = createServer({
    listenHost: '127.0.0.1', listenPort: 0,
    host: { host: '127.0.0.1', port: hostPort, tls: false },
    idleTimeoutMs: 0, resumeGraceMs: 0, maxSessions: 10, allowedOrigins: [],
    screensDir: fs.mkdtempSync(path.join(os.tmpdir(), 'veneer-signon-')),
  });
  servers.push(server);
  const b = await browser(`ws://127.0.0.1:${(await server.listen()).port}/ws`);
  await until(() => b.of('screen').length > 0);
  assert.equal(b.of('signon').length, 0);
  b.signOn('DLONG', 'x');
  await until(() => b.of('error').length > 0);
  assert.equal(b.of('error')[0]!.message, 'Not expecting a sign-on');
  b.close();
});
