import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';
import type { ServerMessage } from '../src/protocol.ts';
import { createServer, type VeneerServer } from '../src/server.ts';
import { FakeHost } from './fakeHost.ts';

let host: FakeHost;
let server: VeneerServer;
let base: string;

before(async () => {
  host = new FakeHost();
  const hostPort = await host.start();
  server = createServer({
    listenHost: '127.0.0.1',
    listenPort: 0,
    host: { host: '127.0.0.1', port: hostPort, tls: false },
    idleTimeoutMs: 0,
    resumeGraceMs: 300,
    maxSessions: 3,
    allowedOrigins: [],
  screensDir: fs.mkdtempSync(path.join(os.tmpdir(), 'veneer-screens-')),
  });
  const addr = await server.listen();
  base = `127.0.0.1:${addr.port}`;
});

after(async () => {
  await server.close();
  await host.stop();
});

/** A WebSocket client that queues messages so tests can await them in order. */
class Client {
  readonly ws: WebSocket;
  private queue: ServerMessage[] = [];
  private waiters: Array<() => void> = [];
  closeCode: number | null = null;

  constructor(headers: Record<string, string> = {}) {
    this.ws = new WebSocket(`ws://${base}/ws`, { headers });
    this.ws.on('message', (d) => { this.queue.push(JSON.parse(d.toString())); this.wake(); });
    this.ws.on('close', (code) => { this.closeCode = code; this.wake(); });
    this.ws.on('error', () => this.wake());
  }

  private wake() { for (const w of this.waiters.splice(0)) w(); }

  open(): Promise<void> {
    return new Promise((resolve, reject) => { this.ws.once('open', resolve); this.ws.once('error', reject); });
  }

  send(msg: object): void { this.ws.send(JSON.stringify(msg)); }

  /** Next message of the given type, skipping others. */
  async next<T extends ServerMessage['type']>(type: T, timeoutMs = 2000): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const i = this.queue.findIndex((m) => m.type === type);
      if (i >= 0) return this.queue.splice(i, 1)[0] as Extract<ServerMessage, { type: T }>;
      if (this.closeCode !== null) throw new Error(`socket closed (${this.closeCode}) waiting for ${type}`);
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out waiting for ${type}`);
      await Promise.race([new Promise<void>((r) => this.waiters.push(r)), sleep(left)]);
    }
  }

  async closed(timeoutMs = 2000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (this.closeCode === null && Date.now() < deadline) await sleep(10);
    if (this.closeCode === null) throw new Error('socket did not close');
    return this.closeCode;
  }
}

async function signedOn(): Promise<{ client: Client; token: string }> {
  const client = new Client();
  await client.open();
  client.send({ type: 'hello' });
  const hello = await client.next('hello');
  assert.equal(hello.resumed, false);
  const screen = await client.next('screen');
  assert.equal(screen.screen.lines[0]!.trim(), 'Sign On');
  return { client, token: hello.resumeToken };
}

test('serves health', async () => {
  const res = await fetch(`http://${base}/healthz`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'ok');
});

test('streams the sign-on screen and submits fields to the host', async () => {
  const { client } = await signedOn();
  const before = host.records.length;
  client.send({ type: 'submit', aid: 'Enter', fields: { '6:53': 'qsecofr', '7:53': 'pw' } });
  const menu = await client.next('screen');
  assert.match(menu.screen.lines[0]!, /MAIN\s+IBM i Main Menu/);
  const rec = host.records.slice(before).find((r) => r[9] === 0x03)!;
  assert.deepEqual([...rec.subarray(10, 13)], [6, 53, 0xf1]);
  assert.ok(menu.screen.fields.every((f) => !f.value.includes('pw')));
  client.send({ type: 'disconnect' });
  assert.equal(await client.closed(), 1000);
});

test('reports protocol errors without closing the socket', async () => {
  const { client } = await signedOn();
  client.send({ type: 'submit', aid: 'Enter', fields: { '9:9': 'x' } });
  assert.match((await client.next('error')).message, /No field 9:9/);
  client.send({ type: 'bogus' });
  assert.match((await client.next('error')).message, /Unknown message type/);
  client.send({ type: 'disconnect' });
  await client.closed();
});

test('keys wait while the host has no Read outstanding (after SysReq)', async () => {
  const { client } = await signedOn();
  client.send({ type: 'sysreq' });
  const screen = await client.next('screen');
  assert.equal(screen.screen.keyboardLocked, true, 'Cancel Invite inhibits input');
  const before = host.records.length;
  client.send({ type: 'submit', aid: 'Enter', fields: { '6:53': 'bob' } });
  assert.match((await client.next('error')).message, /Keyboard is locked/);
  await sleep(50);
  assert.ok(host.records.slice(before).every((r) => r[9] !== 0x03), 'no AID reached the host');
  client.send({ type: 'disconnect' });
  await client.closed();
});

test('resumes a session after the socket drops', async () => {
  const { client, token } = await signedOn();
  const connections = host.connections;
  client.ws.close();
  await client.closed();

  const again = new Client();
  await again.open();
  again.send({ type: 'hello', resumeToken: token });
  const hello = await again.next('hello');
  assert.equal(hello.resumed, true);
  assert.equal((await again.next('screen')).screen.lines[0]!.trim(), 'Sign On');
  assert.equal(host.connections, connections, 'no new host connection');
  again.send({ type: 'disconnect' });
  await again.closed();
});

test('ends the host session when the resume grace period expires', async () => {
  const { client } = await signedOn();
  await sleep(50);
  const open = host.sockets.size;
  client.ws.close();
  await sleep(500);
  assert.equal(host.sockets.size, open - 1);
});

test('rejects cross-origin browsers', async () => {
  const client = new Client({ Origin: 'https://evil.example' });
  await assert.rejects(client.open(), /403/);
});

test('enforces the session limit', async () => {
  await sleep(400); // let earlier sessions finish closing
  const clients = await Promise.all([signedOn(), signedOn(), signedOn()]);
  const extra = new Client();
  await extra.open();
  extra.send({ type: 'hello' });
  assert.match((await extra.next('error')).message, /Too many sessions/);
  assert.equal(await extra.closed(), 4003);
  for (const { client } of clients) client.send({ type: 'disconnect' });
  await Promise.all(clients.map(({ client }) => client.closed()));
});
