import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';
import { DeviceNamePool } from '../src/devices.ts';
import { createServer, type VeneerServer } from '../src/server.ts';
import { FakeHost } from './fakeHost.ts';

test('the pool hands out the lowest free name and reuses released ones', () => {
  const pool = new DeviceNamePool('veneer');
  assert.equal(pool.prefix, 'VENEER');
  assert.deepEqual([pool.acquire(), pool.acquire(), pool.acquire()], ['VENEER001', 'VENEER002', 'VENEER003']);
  pool.release('VENEER002');
  assert.equal(pool.acquire(), 'VENEER002');
});

test('the number width fills the 10-character name, up to 3 digits', () => {
  assert.equal(new DeviceNamePool('WEBSESS1').acquire(), 'WEBSESS101');
  assert.equal(new DeviceNamePool('WEBSESS1').capacity, 99);
  assert.equal(new DeviceNamePool('V').acquire(), 'V001');
});

test('the pool runs out at capacity', () => {
  const pool = new DeviceNamePool('ABCDEFGH');
  for (let i = 0; i < 99; i++) assert.ok(pool.acquire());
  assert.equal(pool.acquire(), undefined);
});

test('invalid prefixes are rejected', () => {
  for (const bad of ['', '1ABC', 'TOOLONGNAME', 'BAD-NAME']) assert.throws(() => new DeviceNamePool(bad), Error, bad);
});

let host: FakeHost;
let server: VeneerServer;
let url: string;

before(async () => {
  host = new FakeHost();
  const port = await host.start();
  server = createServer({
    listenHost: '127.0.0.1', listenPort: 0,
    host: { host: '127.0.0.1', port, tls: false },
    idleTimeoutMs: 0, resumeGraceMs: 0, maxSessions: 10, allowedOrigins: [],
    deviceNamePrefix: 'WEB',
  screensDir: fs.mkdtempSync(path.join(os.tmpdir(), 'veneer-screens-')),
  });
  url = `ws://127.0.0.1:${(await server.listen()).port}/ws`;
});

after(async () => {
  await server.close();
  await host.stop();
});

async function open(): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ type: 'hello' }));
  return ws;
}

test('sessions ask the host for named devices and give them back when they end', async () => {
  const a = await open();
  const b = await open();
  await sleep(200);
  assert.deepEqual(host.deviceNames, ['WEB001', 'WEB002']);
  a.close();
  await sleep(200);
  const c = await open();
  await sleep(200);
  assert.equal(host.deviceNames[2], 'WEB001', 'released name is reused');
  b.close();
  c.close();
});

test('the pool skips names in use elsewhere for a while', async () => {
  const pool = new DeviceNamePool('VENEER');
  pool.avoid('VENEER001', 50);
  assert.equal(pool.acquire(), 'VENEER002');
  const taken = pool.acquire();
  pool.avoid(taken!, 50);
  assert.equal(pool.acquire(), 'VENEER004', 'an avoided name is given back but not reused yet');
  await sleep(60);
  assert.equal(pool.acquire(), 'VENEER001');
  assert.equal(pool.acquire(), 'VENEER003');
});

/** A server with its own fake host and device prefix. */
async function withServer(prefix: string, run: (host: FakeHost, open: () => Promise<Opened>) => Promise<void>): Promise<void> {
  const h = new FakeHost();
  const s = createServer({
    listenHost: '127.0.0.1', listenPort: 0,
    host: { host: '127.0.0.1', port: await h.start(), tls: false },
    idleTimeoutMs: 0, resumeGraceMs: 0, maxSessions: 10, allowedOrigins: [],
    deviceNamePrefix: prefix,
    screensDir: fs.mkdtempSync(path.join(os.tmpdir(), 'veneer-screens-')),
  });
  const u = `ws://127.0.0.1:${(await s.listen()).port}/ws`;
  const open = async (): Promise<Opened> => {
    const ws = new WebSocket(u);
    const messages: Array<{ type: string; message?: string }> = [];
    ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'hello' }));
    return { ws, messages, closed };
  };
  try {
    await run(h, open);
  } finally {
    await s.close();
    await h.stop();
  }
}

interface Opened {
  ws: WebSocket;
  messages: Array<{ type: string; message?: string }>;
  closed: Promise<number>;
}

test('a name held by another job is skipped, on this connection and for later sessions', async () => {
  await withServer('HELD', async (h, open) => {
    h.heldNames.add('HELD001');
    const a = await open();
    await sleep(200);
    assert.deepEqual(h.deviceNames, ['HELD001', 'HELD002'], 'asked again, offered the next name');
    assert.ok(a.messages.some((m) => m.type === 'screen'), 'signed on with the second name');
    const b = await open();
    await sleep(200);
    assert.deepEqual(h.deviceNames.slice(2), ['HELD003'], 'the held name is avoided for later sessions');
    assert.ok(b.messages.some((m) => m.type === 'screen'));
    a.ws.close();
    b.ws.close();
  });
});

test('gives up after a few names and tells the browser', async () => {
  await withServer('BUSY', async (h, open) => {
    for (let i = 1; i <= 9; i++) h.heldNames.add(`BUSY00${i}`);
    const a = await open();
    assert.equal(await a.closed, 4002);
    assert.deepEqual(h.deviceNames, ['BUSY001', 'BUSY002', 'BUSY003', 'BUSY004', null]);
    assert.ok(a.messages.some((m) => m.type === 'error' && /device names/.test(m.message ?? '')));
  });
});
