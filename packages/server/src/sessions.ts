// Browser sessions: each WebSocket owns one TN5250 host session. A socket
// that drops (e.g. a page reload) leaves the host session running for a grace
// period, during which a new socket can reattach with the resume token.

import { randomBytes, randomUUID } from 'node:crypto';
import { Session, type HostSettings } from '@veneer/tn5250';
import WebSocket from 'ws';
import { DeviceNamePool } from './devices.ts';
import type { ScreenInventory } from './inventory.ts';
import { log } from './log.ts';
import { CloseCode, parseClientMessage, type ClientMessage, type ServerMessage } from './protocol.ts';

export interface SessionManagerOptions {
  host: HostSettings;
  idleTimeoutMs: number;
  resumeGraceMs: number;
  maxSessions: number;
  /** Name devices PREFIX01, PREFIX02, ...; unset lets IBM i assign names. */
  deviceNamePrefix?: string | undefined;
  /** How long a new socket has to send its hello message. */
  helloTimeoutMs?: number;
  /** Records each screen sessions show. */
  inventory?: ScreenInventory | undefined;
}

/** Host records often arrive in quick bursts; coalesce them into one screen push. */
const PUSH_DELAY_MS = 10;

export class BrowserSession {
  readonly id = randomUUID();
  readonly resumeToken = randomBytes(32).toString('base64url');
  readonly host: Session;
  readonly deviceName: string | undefined;
  socket: WebSocket | null = null;
  lastActivity = Date.now();
  seq = 0;
  closed = false;
  graceTimer: NodeJS.Timeout | undefined;
  pushTimer: NodeJS.Timeout | undefined;

  constructor(host: Session, deviceName: string | undefined) {
    this.host = host;
    this.deviceName = deviceName;
  }

  send(msg: ServerMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
  }
}

export class SessionManager {
  private readonly opts: SessionManagerOptions;
  private readonly sessions = new Map<string, BrowserSession>(); // by resume token
  private readonly idleSweep: NodeJS.Timeout;
  private readonly devices: DeviceNamePool | undefined;

  constructor(opts: SessionManagerOptions) {
    this.opts = opts;
    this.devices = opts.deviceNamePrefix ? new DeviceNamePool(opts.deviceNamePrefix) : undefined;
    this.idleSweep = setInterval(() => this.sweepIdle(), Math.min(30_000, Math.max(1000, opts.idleTimeoutMs / 4)));
    this.idleSweep.unref();
  }

  get size(): number {
    return this.sessions.size;
  }

  /** Take ownership of a new socket. Its first message must be a hello. */
  accept(socket: WebSocket, remote: string): void {
    const timer = setTimeout(() => socket.close(CloseCode.POLICY_VIOLATION, 'No hello received'), this.opts.helloTimeoutMs ?? 5000);
    socket.once('message', (data) => {
      clearTimeout(timer);
      let msg: ClientMessage;
      try {
        msg = parseClientMessage(data.toString());
      } catch (err) {
        return rejectSocket(socket, (err as Error).message);
      }
      if (msg.type !== 'hello') return rejectSocket(socket, 'First message must be hello');
      const existing = msg.resumeToken ? this.sessions.get(msg.resumeToken) : undefined;
      if (existing && !existing.closed) this.attach(existing, socket, true, remote);
      else this.create(socket, remote);
    });
  }

  private create(socket: WebSocket, remote: string): void {
    if (this.sessions.size >= this.opts.maxSessions) {
      log.warn('session limit reached', { remote, max: this.opts.maxSessions });
      socket.send(JSON.stringify({ type: 'error', message: 'Too many sessions; try again later' } satisfies ServerMessage));
      socket.close(CloseCode.SESSION_LIMIT, 'Session limit reached');
      return;
    }
    const deviceName = this.devices?.acquire();
    if (this.devices && !deviceName) {
      log.warn('no free device names', { prefix: this.devices.prefix, capacity: this.devices.capacity });
      socket.send(JSON.stringify({ type: 'error', message: 'Too many sessions; try again later' } satisfies ServerMessage));
      socket.close(CloseCode.SESSION_LIMIT, 'No free device names');
      return;
    }
    const host = new Session({ ...this.opts.host, ...(deviceName ? { deviceName } : {}) });
    const bs = new BrowserSession(host, deviceName);
    this.sessions.set(bs.resumeToken, bs);
    log.info('session created', { session: bs.id, remote, ...(deviceName ? { device: deviceName } : {}) });

    host.on('screen', () => this.schedulePush(bs));
    host.on('warning', (message) => log.warn('protocol warning', { session: bs.id, message }));
    host.on('close', (err) => {
      if (err) log.warn('host connection error', { session: bs.id, error: err.message });
      this.destroy(bs, CloseCode.HOST_CLOSED, 'Host closed the connection');
    });

    this.attach(bs, socket, false, remote);
    bs.send({ type: 'status', state: 'connecting' });
    host.connect().then(
      () => {
        log.info('host connected', { session: bs.id });
        bs.send({ type: 'status', state: 'connected' });
      },
      (err: Error) => {
        log.warn('host connect failed', { session: bs.id, error: err.message });
        bs.send({ type: 'error', message: `Could not connect to the IBM i: ${err.message}` });
        this.destroy(bs, CloseCode.HOST_CLOSED, 'Host connection failed');
      },
    );
  }

  private attach(bs: BrowserSession, socket: WebSocket, resumed: boolean, remote: string): void {
    clearTimeout(bs.graceTimer);
    bs.graceTimer = undefined;
    if (bs.socket && bs.socket !== socket) bs.socket.close(CloseCode.REPLACED, 'Session opened elsewhere');
    bs.socket = socket;
    bs.lastActivity = Date.now();
    if (resumed) log.info('session resumed', { session: bs.id, remote });

    socket.on('message', (data) => this.onMessage(bs, socket, data.toString()));
    socket.on('close', () => this.onSocketClose(bs, socket));

    bs.send({ type: 'hello', sessionId: bs.id, resumeToken: bs.resumeToken, resumed });
    if (resumed) {
      bs.send({ type: 'status', state: bs.host.connected ? 'connected' : 'connecting' });
      this.push(bs);
    }
  }

  private onMessage(bs: BrowserSession, socket: WebSocket, raw: string): void {
    if (bs.socket !== socket || bs.closed) return;
    bs.lastActivity = Date.now();
    let msg: ClientMessage;
    try {
      msg = parseClientMessage(raw);
    } catch (err) {
      bs.send({ type: 'error', message: (err as Error).message });
      return;
    }
    try {
      switch (msg.type) {
        case 'hello':
          throw new Error('Already said hello');
        case 'submit':
          bs.host.submit({
            aid: msg.aid,
            ...(msg.fields ? { fields: msg.fields } : {}),
            ...(msg.cursor ? { cursor: msg.cursor } : {}),
          });
          break;
        case 'reset':
          bs.host.reset();
          break;
        case 'sysreq':
          bs.host.systemRequest();
          break;
        case 'attn':
          bs.host.attention();
          break;
        case 'disconnect':
          log.info('session ended by client', { session: bs.id });
          this.destroy(bs, CloseCode.NORMAL, 'Disconnected');
          break;
      }
    } catch (err) {
      bs.send({ type: 'error', message: (err as Error).message });
    }
  }

  private onSocketClose(bs: BrowserSession, socket: WebSocket): void {
    if (bs.socket !== socket || bs.closed) return;
    bs.socket = null;
    if (this.opts.resumeGraceMs <= 0) return this.destroy(bs, CloseCode.GOING_AWAY, 'Socket closed');
    log.info('socket detached', { session: bs.id, graceMs: this.opts.resumeGraceMs });
    bs.graceTimer = setTimeout(() => this.destroy(bs, CloseCode.GOING_AWAY, 'Resume grace period expired'), this.opts.resumeGraceMs);
  }

  private schedulePush(bs: BrowserSession): void {
    if (bs.pushTimer) return;
    bs.pushTimer = setTimeout(() => {
      bs.pushTimer = undefined;
      this.push(bs);
    }, PUSH_DELAY_MS);
  }

  private push(bs: BrowserSession): void {
    if (bs.closed || !bs.socket) return;
    const screen = bs.host.snapshot();
    // A locked screen is the host still working; count the one the user gets.
    if (!screen.keyboardLocked) this.opts.inventory?.record(bs.id, screen);
    bs.send({ type: 'screen', seq: ++bs.seq, screen });
  }

  private sweepIdle(): void {
    if (this.opts.idleTimeoutMs <= 0) return;
    const cutoff = Date.now() - this.opts.idleTimeoutMs;
    for (const bs of this.sessions.values()) {
      if (bs.lastActivity < cutoff) {
        log.info('session idle timeout', { session: bs.id });
        bs.send({ type: 'error', message: 'Session ended after a period of inactivity' });
        this.destroy(bs, CloseCode.IDLE_TIMEOUT, 'Idle timeout');
      }
    }
  }

  private destroy(bs: BrowserSession, code: number, reason: string): void {
    if (bs.closed) return;
    bs.closed = true;
    clearTimeout(bs.graceTimer);
    clearTimeout(bs.pushTimer);
    this.sessions.delete(bs.resumeToken);
    bs.send({ type: 'status', state: 'closed', message: reason });
    bs.socket?.close(code, reason);
    bs.socket = null;
    bs.host.close();
    if (bs.deviceName) this.devices?.release(bs.deviceName);
    this.opts.inventory?.forget(bs.id);
    log.info('session closed', { session: bs.id, reason });
  }

  /** Send a message to every attached browser. */
  broadcast(msg: ServerMessage): void {
    for (const bs of this.sessions.values()) bs.send(msg);
  }

  /** End every session, e.g. on server shutdown, so the IBM i releases the devices. */
  closeAll(reason = 'Server shutting down'): void {
    clearInterval(this.idleSweep);
    for (const bs of [...this.sessions.values()]) this.destroy(bs, CloseCode.GOING_AWAY, reason);
  }
}

function rejectSocket(socket: WebSocket, message: string): void {
  socket.send(JSON.stringify({ type: 'error', message } satisfies ServerMessage));
  socket.close(CloseCode.POLICY_VIOLATION, 'Bad hello');
}
