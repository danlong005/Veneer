import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { Session as Session3270 } from '@veneer/tn3270';
import { Session as Session5250 } from '@veneer/tn5250';
import WebSocket from 'ws';
import { loadConfig } from '../src/config.ts';
import { DeviceNamePool } from '../src/devices.ts';
import { createHostSession, hostAid, hostSettingsFromEnv, pageKeysOf } from '../src/host.ts';
import type { ServerMessage } from '../src/protocol.ts';
import { createServer } from '../src/server.ts';
import { FakeHost3270 } from './fakeHost3270.ts';

const HOST = { VENEER_HOST: 'host.example.com' };

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !done(); i++) await sleep(5);
}

test('the host type defaults to 5250, and 3270 is chosen with VENEER_HOST_TYPE', () => {
  assert.equal(hostSettingsFromEnv(HOST).type, '5250');
  const s = hostSettingsFromEnv({ ...HOST, VENEER_HOST_TYPE: '3270', VENEER_TERMINAL_TYPE: 'IBM-3278-5-E', VENEER_CCSID: '1047', VENEER_TN3270E: 'false', VENEER_TLS: 'false' });
  assert.deepEqual(s, { type: '3270', host: 'host.example.com', tls: false, terminalType: 'IBM-3278-5-E', ccsid: 1047, tn3270e: false });
  assert.equal(hostSettingsFromEnv({ ...HOST, VENEER_HOST_TYPE: '3270', VENEER_TN3270E: 'true' }).tn3270e, undefined, 'true is the default');
});

test('host settings are checked when the server starts', () => {
  assert.throws(() => hostSettingsFromEnv({}), /VENEER_HOST is not set/);
  assert.throws(() => hostSettingsFromEnv({ ...HOST, VENEER_HOST_TYPE: '3179' }), /must be 5250 or 3270/);
  assert.throws(() => hostSettingsFromEnv({ ...HOST, VENEER_HOST_TYPE: '3270', VENEER_TERMINAL_TYPE: 'IBM-3179-2' }), /IBM-3179-2 is not supported/);
  assert.throws(() => hostSettingsFromEnv({ ...HOST, VENEER_TN3270E: 'false' }), /for 3270 hosts/);
  assert.throws(() => hostSettingsFromEnv({ ...HOST, VENEER_HOST_TYPE: '3270', VENEER_TN3270E: 'no' }), /true or false/);
  assert.throws(() => hostSettingsFromEnv({ ...HOST, VENEER_CCSID: '9999' }), /VENEER_CCSID 9999 is not supported/);
  assert.throws(() => hostSettingsFromEnv({ ...HOST, VENEER_PORT: '99999' }), /not a valid port/);
  // 5250 terminal types are not checked here; the IBM i decides.
  assert.equal(hostSettingsFromEnv({ ...HOST, VENEER_TERMINAL_TYPE: 'IBM-3477-FC' }).terminalType, 'IBM-3477-FC');
});

test('Page Up and Page Down send PF7 and PF8 on a 3270, or the keys VENEER_PAGE_KEYS names', () => {
  const mainframe = (VENEER_PAGE_KEYS?: string) => hostSettingsFromEnv({ ...HOST, VENEER_HOST_TYPE: '3270', ...(VENEER_PAGE_KEYS !== undefined ? { VENEER_PAGE_KEYS } : {}) });
  assert.deepEqual(pageKeysOf(mainframe()), { up: 'F7', down: 'F8' }, 'the default');
  assert.deepEqual(pageKeysOf(mainframe('')), { up: 'F7', down: 'F8' });
  assert.deepEqual(pageKeysOf(mainframe('PF19, PF20')), { up: 'F19', down: 'F20' });
  assert.deepEqual(pageKeysOf(mainframe('f10,F11')), { up: 'F10', down: 'F11' }, 'F or PF, any case');
  assert.deepEqual(pageKeysOf(mainframe('pa1,PA2')), { up: 'PA1', down: 'PA2' });
  assert.equal(pageKeysOf(mainframe('off')), null);
  for (const bad of ['PF7', 'PF7,PF8,PF9', 'PF7,PageDown', 'PF7,Help', 'PF25,PF8', 'Clear,PF8']) {
    assert.throws(() => mainframe(bad), /VENEER_PAGE_KEYS must be two 3270 keys/, bad);
  }
  assert.throws(() => hostSettingsFromEnv({ ...HOST, VENEER_PAGE_KEYS: 'PF7,PF8' }), /for 3270 hosts/);

  assert.equal(hostAid(mainframe(), 'PageDown'), 'F8');
  assert.equal(hostAid(mainframe('PF19,PF20'), 'PageUp'), 'F19');
  assert.equal(hostAid(mainframe(), 'F3'), 'F3', 'other keys as they are');
  assert.equal(hostAid(mainframe('off'), 'PageDown'), 'PageDown', 'left for the session to refuse');
  const ibmi = hostSettingsFromEnv(HOST);
  assert.equal(hostAid(ibmi, 'PageDown'), 'PageDown', 'a 5250 has its own');
  assert.deepEqual(pageKeysOf(ibmi), { up: 'PageUp', down: 'PageDown' });
});

test('/api/config tells the browser the host type and its page keys', async () => {
  const config = async (env: NodeJS.ProcessEnv) => {
    const server = createServer({ ...loadConfig({ ...HOST, ...env }), listenHost: '127.0.0.1', listenPort: 0, screensDir: fs.mkdtempSync(path.join(os.tmpdir(), 'veneer-screens-')) });
    const addr = await server.listen();
    try {
      return (await (await fetch(`http://127.0.0.1:${addr.port}/api/config`)).json()) as { host: unknown };
    } finally {
      await server.close();
    }
  };
  assert.deepEqual((await config({})).host, { type: '5250', pageKeys: { up: 'PageUp', down: 'PageDown' } });
  assert.deepEqual((await config({ VENEER_HOST_TYPE: '3270' })).host, { type: '3270', pageKeys: { up: 'F7', down: 'F8' } });
  assert.deepEqual((await config({ VENEER_HOST_TYPE: '3270', VENEER_PAGE_KEYS: 'off' })).host, { type: '3270', pageKeys: null });
});

test('each host type gets its own session', () => {
  assert.ok(createHostSession({ host: 'x' }) instanceof Session5250, 'no type: 5250');
  assert.ok(createHostSession({ type: '5250', host: 'x' }) instanceof Session5250);
  assert.ok(createHostSession({ type: '3270', host: 'x' }) instanceof Session3270);
});

test('LU names are at most 8 characters, IBM i device names 10', () => {
  assert.equal(new DeviceNamePool('VENLU', 8).acquire(), 'VENLU001');
  assert.equal(new DeviceNamePool('VENEER', 8).acquire(), 'VENEER01', 'room for two digits at least');
  assert.throws(() => new DeviceNamePool('VENEERS', 8), /1-6 letters/);
  assert.equal(new DeviceNamePool('VENEERSX').acquire(), 'VENEERSX01');
  assert.throws(() => loadConfig({ ...HOST, VENEER_HOST_TYPE: '3270', VENEER_DEVNAME_PREFIX: 'VENEERSX' }), /1-6 letters/);
  assert.equal(loadConfig({ ...HOST, VENEER_DEVNAME_PREFIX: 'VENEERSX' }).deviceNamePrefix, 'VENEERSX');
});

/** What a session answers when a host offers TN3270E. */
async function answerToTn3270e(settings: Parameters<typeof createHostSession>[0]): Promise<number[]> {
  const server = net.createServer((s) => s.write(Buffer.from([0xff, 0xfd, 0x28])));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const reply = new Promise<number[]>((resolve) => server.once('connection', (s) => s.once('data', (d) => resolve([...d]))));
  const session = createHostSession({ ...settings, host: '127.0.0.1', port: (server.address() as net.AddressInfo).port, tls: false });
  try {
    await session.connect();
    return await reply;
  } finally {
    session.close();
    server.close();
  }
}

test('VENEER_TN3270E=false reaches the session: it turns TN3270E down', async () => {
  assert.deepEqual(await answerToTn3270e({ type: '3270', host: '' }), [0xff, 0xfb, 0x28], 'WILL by default');
  assert.deepEqual(await answerToTn3270e({ type: '3270', host: '', tn3270e: false }), [0xff, 0xfc, 0x28], 'WONT when off');
});

/** Next message of a type from a socket, skipping others. */
function reader(ws: WebSocket) {
  const queue: ServerMessage[] = [];
  ws.on('message', (d) => queue.push(JSON.parse(d.toString())));
  return async <T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>> => {
    for (let i = 0; i < 400; i++) {
      const k = queue.findIndex((m) => m.type === type);
      if (k >= 0) return queue.splice(k, 1)[0] as Extract<ServerMessage, { type: T }>;
      await sleep(5);
    }
    throw new Error(`timed out waiting for ${type}`);
  };
}

test('a 3270 host: the browser gets 3270 screens and sends keys back, with pooled LU names', async () => {
  const host = new FakeHost3270();
  const port = await host.start();
  const server = createServer({
    listenHost: '127.0.0.1', listenPort: 0,
    host: { type: '3270', host: '127.0.0.1', port, tls: false },
    idleTimeoutMs: 0, resumeGraceMs: 0, maxSessions: 2, allowedOrigins: [],
    deviceNamePrefix: 'VENLU',
    screensDir: fs.mkdtempSync(path.join(os.tmpdir(), 'veneer-screens-')),
  });
  const addr = await server.listen();
  const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws`);
  try {
    const next = reader(ws);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'hello' }));
    let screen = (await next('screen')).screen;
    while (screen.keyboardLocked) screen = (await next('screen')).screen;
    assert.equal(screen.host, '3270');
    assert.equal(screen.lines[0]!.trim(), 'Sign On');
    assert.deepEqual(host.lus, ['VENLU001']);
    assert.deepEqual(host.terminalTypes, ['IBM-3278-2-E']);

    ws.send(JSON.stringify({ type: 'submit', aid: 'Enter', fields: { '5:30': 'IBMUSER' } }));
    do screen = (await next('screen')).screen; while (screen.keyboardLocked || screen.lines[0]!.trim() !== 'Main Menu');
    assert.equal(host.records[0]![0], 0x7d);

    // Page Down sends PF8 on a 3270 (VENEER_PAGE_KEYS); Help it has no key for.
    ws.send(JSON.stringify({ type: 'submit', aid: 'PageDown' }));
    await until(() => host.records.length === 2);
    assert.equal(host.records[1]![0], 0xf8, 'PF8');
    ws.send(JSON.stringify({ type: 'submit', aid: 'Help' }));
    assert.match((await next('error')).message, /A 3270 has no Help key/);
  } finally {
    ws.close();
    await server.close();
    await host.stop();
  }
});
