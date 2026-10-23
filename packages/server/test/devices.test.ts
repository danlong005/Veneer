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
