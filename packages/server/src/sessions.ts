// Browser sessions: each WebSocket owns one host session (5250 or 3270). A socket
// that drops (e.g. a page reload) leaves the host session running for a grace
// period, during which a new socket can reattach with the resume token.

import { randomBytes, randomUUID } from 'node:crypto';
import { DeviceNameInUseError, type HostType, type ScreenSnapshot, type SignOnResult, type TerminalSession } from '@veneer/terminal';
import WebSocket from 'ws';
import { DeviceNamePool } from './devices.ts';
import {
  USER_PROFILE, createHostSession, deviceNameLength, hostAid, hostLabel, hostTypeOf, passwordProblem, type AutoSignOn, type HostSettings,
} from './host.ts';
import type { ScreenInventory } from './inventory.ts';
import { log } from './log.ts';
import { CloseCode, SIGN_ON_EXTRAS, parseClientMessage, type ClientMessage, type PasswordRules, type ServerMessage } from './protocol.ts';
import { displayName, signOnUserField, submittedUser } from './signon.ts';

export interface SessionManagerOptions {
  host: HostSettings;
  idleTimeoutMs: number;
  resumeGraceMs: number;
  maxSessions: number;
  /** Name devices (or LUs) PREFIX01, PREFIX02, ...; unset lets the host assign names. */
  deviceNamePrefix?: string | undefined;
  /** Log every host record; see traceRecord. */
  trace?: boolean;
  /** How long a new socket has to send its hello message. */
  helloTimeoutMs?: number;
  /** Records each screen sessions show. */
  inventory?: ScreenInventory | undefined;
  /** The first wait after repeated sign-on failures from one address; it doubles each time. Default 2 seconds. */
  signOnDelayMs?: number;
}

/** What the admin page shows about a session. */
export interface SessionInfo {
  id: string;
  /** IBM i user, once signed on. */
  user: string | null;
  device: string | null;
  remote: string;
  connectedAt: string;
  lastActivity: string;
  hostConnected: boolean;
  /** A browser is attached; otherwise the session waits for a reload until `graceEndsAt`. */
  attached: boolean;
  graceEndsAt: string | null;
}

/** Other device names to try when the host says one is in use. */
const DEVICE_NAME_RETRIES = 3;

/** Host records often arrive in quick bursts; coalesce them into one screen push. */
const PUSH_DELAY_MS = 10;

/** Sign-on failures from one address before each further attempt waits; the wait doubles to at most a minute. */
const FREE_SIGN_ON_FAILURES = 2;
const MAX_SIGN_ON_WAIT_MS = 60_000;
/** An address's failures are forgotten this long after its last one. */
const SIGN_ON_FAILURES_KEPT_MS = 15 * 60_000;

export class BrowserSession {
  readonly id = randomUUID();
  readonly resumeToken = randomBytes(32).toString('base64url');
  /** The host session; null while Veneer's sign-on page shows (automatic sign-on). */
  host: TerminalSession | null = null;
  /** Requested device name; changes when the host says a name is in use. */
  deviceName: string | undefined;
  readonly remote: string;
  /** The page is on HTTPS or this machine, so it may send a password. */
  readonly secure: boolean;
  /** An automatic sign-on is under way: the host connection is starting, or a failure is being held back. */
  signingOn = false;
  readonly createdAt = Date.now();
  /** Display name read from the sign-on screen when IBM i assigned it. */
  shownDevice: string | undefined;
  /** User signed on, and the one submitted on the sign-on screen until the host accepts it. */
  user: string | undefined;
  pendingUser: string | undefined;
  socket: WebSocket | null = null;
  lastActivity = Date.now();
  graceEndsAt: number | undefined;
  seq = 0;
  closed = false;
  graceTimer: NodeJS.Timeout | undefined;
  pushTimer: NodeJS.Timeout | undefined;

  constructor(remote: string, secure: boolean) {
    this.remote = remote;
    this.secure = secure;
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
  /** The IBM i turned automatic sign-on down (QRMTSIGN); later sessions use its sign-on screen. */
  private signOnRefused = false;
  /** Failed automatic sign-ons by address, to slow down guessing. */
  private readonly signOnFailures = new Map<string, { count: number; last: number; nextAt: number }>();

  constructor(opts: SessionManagerOptions) {
    this.opts = opts;
    this.devices = opts.deviceNamePrefix ? new DeviceNamePool(opts.deviceNamePrefix, deviceNameLength(hostTypeOf(opts.host))) : undefined;
    this.idleSweep = setInterval(() => this.sweepIdle(), Math.min(30_000, Math.max(1000, opts.idleTimeoutMs / 4)));
    this.idleSweep.unref();
  }

  get size(): number {
    return this.sessions.size;
  }

  /** Users sign on from Veneer's page (VENEER_SIGNON=auto) unless the IBM i turned it down. */
  get autoSignOn(): boolean {
    return this.opts.host.autoSignOn !== undefined && !this.signOnRefused;
  }

  /** What passwords the IBM i takes, for the sign-on page. */
  private get passwordRules(): PasswordRules {
    return this.opts.host.autoSignOn?.substitute === 'des' ? { maxLength: 10, caseSensitive: false } : { maxLength: 128, caseSensitive: true };
  }

  /**
   * Take ownership of a new socket. Its first message must be a hello.
   * `secure`: the page is on HTTPS or this machine, so it may send a password.
   */
  accept(socket: WebSocket, remote: string, secure = false): void {
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
      else this.create(socket, remote, secure);
    });
  }

  private create(socket: WebSocket, remote: string, secure: boolean): void {
    if (this.sessions.size >= this.opts.maxSessions) {
      log.warn('session limit reached', { remote, max: this.opts.maxSessions });
      socket.send(JSON.stringify({ type: 'error', message: 'Too many sessions; try again later' } satisfies ServerMessage));
      socket.close(CloseCode.SESSION_LIMIT, 'Session limit reached');
      return;
    }
    if (this.devices && this.devices.capacity <= this.hostsOpen()) {
      log.warn('no free device names', { prefix: this.devices.prefix, capacity: this.devices.capacity });
      socket.send(JSON.stringify({ type: 'error', message: 'Too many sessions; try again later' } satisfies ServerMessage));
      socket.close(CloseCode.SESSION_LIMIT, 'No free device names');
      return;
    }
    const bs = new BrowserSession(remote, secure);
    this.sessions.set(bs.resumeToken, bs);
    log.info('session created', { session: bs.id, remote });
    this.attach(bs, socket, false, remote);
    // With automatic sign-on, the host connection waits for Veneer's sign-on page.
    if (this.autoSignOn) bs.send({ type: 'signon', password: this.passwordRules });
    else this.connectHost(bs);
  }

  /** Sessions holding a device name, for the pool's capacity check. */
  private hostsOpen(): number {
    let n = 0;
    for (const bs of this.sessions.values()) if (bs.deviceName) n++;
    return n;
  }

  /** Connect a session to the host, signing on with `signOn` if given. */
  private connectHost(bs: BrowserSession, signOn?: AutoSignOn): void {
    const deviceName = this.devices?.acquire();
    if (this.devices && !deviceName) {
      log.warn('no free device names', { prefix: this.devices.prefix, capacity: this.devices.capacity });
      bs.send({ type: 'error', message: 'Too many sessions; try again later' });
      return this.destroy(bs, CloseCode.SESSION_LIMIT, 'No free device names');
    }
    bs.deviceName = deviceName;
    let retries = 0;
    const host: TerminalSession = createHostSession(this.opts.host, {
      ...(this.opts.trace ? { trace: (dir: 'in' | 'out', rec: Buffer) => traceRecord(bs, dir, rec, hostTypeOf(this.opts.host)) } : {}),
      ...(deviceName ? { deviceName, onDeviceNameInUse: (name: string) => this.nextDeviceName(bs, name, ++retries) } : {}),
      ...(signOn ? { autoSignOn: signOn } : {}),
    });
    bs.host = host;
    if (deviceName) log.info('device requested', { session: bs.id, device: deviceName });
    // Events from a host connection the session has since let go (a failed sign-on) are ignored.
    const current = () => bs.host === host && !bs.closed;

    host.once('screen', (screen) => {
      if (current()) log.info('device assigned', { session: bs.id, device: bs.deviceName ?? bs.shownDevice ?? displayName(screen) ?? 'unknown' });
    });
    host.on('screen', () => { if (current()) this.schedulePush(bs); });
    host.on('signOn', (result) => { if (current()) this.onSignOn(bs, result); });
    host.on('warning', (message) => log.warn('protocol warning', { session: bs.id, message }));
    host.on('close', (err) => {
      if (!current()) return;
      if (err instanceof DeviceNameInUseError) {
        bs.send({ type: 'error', message: `All device names tried are in use on ${hostLabel(hostTypeOf(this.opts.host))}; try again later` });
        return this.destroy(bs, CloseCode.HOST_CLOSED, 'No free device name');
      }
      if (err) log.warn('host connection error', { session: bs.id, error: err.message });
      this.destroy(bs, CloseCode.HOST_CLOSED, 'Host closed the connection');
    });

    bs.send({ type: 'status', state: 'connecting' });
    host.connect().then(
      () => {
        if (!current()) return;
        log.info('host connected', { session: bs.id });
        bs.send({ type: 'status', state: 'connected' });
      },
      (err: Error) => {
        if (!current()) return;
        log.warn('host connect failed', { session: bs.id, error: err.message });
        bs.send({ type: 'error', message: `Could not connect to ${hostLabel(hostTypeOf(this.opts.host))}: ${err.message}` });
        this.destroy(bs, CloseCode.HOST_CLOSED, 'Host connection failed');
      },
    );
  }

  /** Let go of a session's host connection and its device, e.g. after a failed sign-on. */
  private dropHost(bs: BrowserSession): void {
    const host = bs.host;
    bs.host = null;
    host?.close();
    if (bs.deviceName) this.devices?.release(bs.deviceName);
    bs.deviceName = undefined;
    bs.shownDevice = undefined;
    clearTimeout(bs.pushTimer);
    bs.pushTimer = undefined;
  }

  /** A sign-on from Veneer's page: check it, wait if this address has been failing, then connect with it. */
  private signOn(bs: BrowserSession, msg: Extract<ClientMessage, { type: 'signon' }>): void {
    const substitute = this.opts.host.autoSignOn?.substitute;
    if (!substitute || bs.host || bs.signingOn) throw new Error('Not expecting a sign-on');
    const again = (error: string) => bs.send({ type: 'signon', password: this.passwordRules, error });
    if (!bs.secure) return again('Veneer takes passwords only over HTTPS. Ask your administrator for the https:// address.');
    const user = msg.user.trim().toUpperCase();
    if (!user) return again('Type your user name.');
    if (!USER_PROFILE.test(user)) return again('A user name is up to 10 letters and digits (and # $ @ _), starting with a letter.');
    const problem = passwordProblem(msg.password, substitute);
    if (problem) return again(problem);
    const extras: Partial<Record<(typeof SIGN_ON_EXTRAS)[number], string>> = {};
    for (const key of SIGN_ON_EXTRAS) {
      const value = msg[key]?.trim().toUpperCase();
      if (!value) continue;
      if (!USER_PROFILE.test(value)) return again(`The ${key === 'library' ? 'current library' : key} must be an IBM i name: up to 10 letters and digits, starting with a letter.`);
      extras[key] = value;
    }
    const signOn: AutoSignOn = { user, password: msg.password, substitute, ...extras };
    bs.signingOn = true;
    bs.pendingUser = user;
    const wait = this.signOnWait(bs.remote);
    if (wait > 0) log.info('sign-on held back', { session: bs.id, remote: bs.remote, ms: wait });
    setTimeout(() => {
      if (bs.closed) return;
      this.connectHost(bs, signOn);
    }, wait);
  }

  /** How long this address's next sign-on waits, after several failures; reserves its turn. */
  private signOnWait(remote: string): number {
    const now = Date.now();
    const f = this.signOnFailures.get(remote);
    if (!f || now - f.last > SIGN_ON_FAILURES_KEPT_MS) {
      this.signOnFailures.delete(remote);
      return 0;
    }
    if (f.count < FREE_SIGN_ON_FAILURES) return 0;
    const spacing = Math.min(MAX_SIGN_ON_WAIT_MS, (this.opts.signOnDelayMs ?? 2000) * 2 ** (f.count - FREE_SIGN_ON_FAILURES));
    // After the last failure, and after any attempt from the same address already waiting.
    const at = Math.max(now, f.last + spacing, f.nextAt);
    f.nextAt = at + spacing;
    return at - now;
  }

  /** How an automatic sign-on went. */
  private onSignOn(bs: BrowserSession, result: SignOnResult): void {
    const user = bs.pendingUser;
    bs.signingOn = false;
    if (result.device) bs.shownDevice = result.device;
    switch (result.outcome) {
      case 'signed-on':
        this.signOnFailures.delete(bs.remote);
        bs.user = user;
        bs.pendingUser = undefined;
        log.info('signed on', { session: bs.id, user: bs.user ?? null, automatic: true });
        return;
      case 'expired':
        // The host's sign-on screen shows; signing on there leads to changing the password.
        bs.pendingUser = undefined;
        log.info('password expired', { session: bs.id, user: user ?? null });
        bs.send({ type: 'notice', message: 'Your password has expired. Sign on here to change it.' });
        return;
      case 'not-allowed':
        bs.pendingUser = undefined;
        this.refuseAutoSignOn(result.code);
        // Start again without it, so the host's own sign-on screen shows.
        this.dropHost(bs);
        bs.send({ type: 'notice', message: 'This IBM i doesn\'t allow automatic sign-on, so sign on on its own screen.' });
        this.connectHost(bs);
        return;
      case 'rejected': {
        bs.pendingUser = undefined;
        this.dropHost(bs);
        const now = Date.now();
        const f = this.signOnFailures.get(bs.remote);
        const count = f && now - f.last <= SIGN_ON_FAILURES_KEPT_MS ? f.count + 1 : 1;
        this.signOnFailures.set(bs.remote, { count, last: now, nextAt: f?.nextAt ?? now });
        log.warn('automatic sign-on failed', { session: bs.id, user: user ?? null, code: result.code ?? null, remote: bs.remote });
        bs.send({ type: 'signon', password: this.passwordRules, error: signOnError(result.code) });
        return;
      }
    }
  }

  /**
   * The host shows its sign-on screen and never said why: a wrong password
   * and a refusal look the same. That user signs on there; later sessions
   * still get Veneer's page.
   */
  private signOnUnknown(bs: BrowserSession): void {
    bs.signingOn = false;
    log.warn('automatic sign-on did not sign the user on, and the IBM i sent no Startup Response Record', { session: bs.id, user: bs.pendingUser ?? null });
    bs.pendingUser = undefined;
    bs.send({ type: 'notice', message: 'Veneer couldn\'t sign you on automatically. Sign on here.' });
  }

  /** Said once: the IBM i won't sign users on from Veneer's page. */
  private refuseAutoSignOn(code: string | undefined): void {
    if (this.signOnRefused) return;
    this.signOnRefused = true;
    log.warn('automatic sign-on is not allowed by the IBM i; users sign on on its sign-on screen until Veneer restarts', {
      code: code ?? 'no seed offered',
      fix: 'set the QRMTSIGN system value to *VERIFY or *SAMEPRF, then restart Veneer',
    });
  }

  /**
   * The host says `name` is in use, e.g. by a job left over from before a
   * restart or another emulator. Skip it for a while and offer the next one.
   */
  private nextDeviceName(bs: BrowserSession, name: string, attempt: number): string | undefined {
    this.devices!.avoid(name);
    const next = attempt <= DEVICE_NAME_RETRIES ? this.devices!.acquire() : undefined;
    log.warn('device name in use', { session: bs.id, device: name, ...(next ? { trying: next } : { giving_up: true }) });
    bs.deviceName = next;
    return next;
  }

  private attach(bs: BrowserSession, socket: WebSocket, resumed: boolean, remote: string): void {
    clearTimeout(bs.graceTimer);
    bs.graceTimer = undefined;
    bs.graceEndsAt = undefined;
    if (bs.socket && bs.socket !== socket) bs.socket.close(CloseCode.REPLACED, 'Session opened elsewhere');
    bs.socket = socket;
    bs.lastActivity = Date.now();
    if (resumed) log.info('session resumed', { session: bs.id, remote });

    socket.on('message', (data) => this.onMessage(bs, socket, data.toString()));
    socket.on('close', () => this.onSocketClose(bs, socket));

    bs.send({ type: 'hello', sessionId: bs.id, resumeToken: bs.resumeToken, resumed });
    if (resumed && bs.host) {
      bs.send({ type: 'status', state: bs.host.connected ? 'connected' : 'connecting' });
      this.push(bs);
    } else if (resumed && !bs.signingOn) {
      bs.send({ type: 'signon', password: this.passwordRules });
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
        case 'signon':
          this.signOn(bs, msg);
          break;
        case 'macro':
          // Who ran what and how it went; the values it was given stay out of the log.
          log.info('macro run', { session: bs.id, user: bs.user ?? null, macro: msg.macro, outcome: msg.outcome, ...(msg.step ? { step: msg.step } : {}) });
          break;
        case 'disconnect':
          log.info('session ended by client', { session: bs.id });
          this.destroy(bs, CloseCode.NORMAL, 'Disconnected');
          break;
        default:
          this.hostMessage(bs, msg);
      }
    } catch (err) {
      bs.send({ type: 'error', message: (err as Error).message });
    }
  }

  /** Keys and the like, for the host. */
  private hostMessage(bs: BrowserSession, msg: Extract<ClientMessage, { type: 'submit' | 'reset' | 'sysreq' | 'attn' }>): void {
    if (!bs.host) throw new Error('Not signed on yet');
    switch (msg.type) {
        case 'submit':
          bs.pendingUser = submittedUser(bs.host.snapshot(), msg.fields);
          bs.host.submit({
            // On a 3270, Page Up and Page Down send the keys VENEER_PAGE_KEYS names.
            aid: hostAid(this.opts.host, msg.aid),
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
    }
  }

  private onSocketClose(bs: BrowserSession, socket: WebSocket): void {
    if (bs.socket !== socket || bs.closed) return;
    bs.socket = null;
    if (this.opts.resumeGraceMs <= 0) return this.destroy(bs, CloseCode.GOING_AWAY, 'Socket closed');
    log.info('socket detached', { session: bs.id, graceMs: this.opts.resumeGraceMs });
    bs.graceEndsAt = Date.now() + this.opts.resumeGraceMs;
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
    if (bs.closed || !bs.socket || !bs.host) return;
    const screen = bs.host.snapshot();
    // A host that sent no Startup Response Record: its first screen says how sign-on went.
    if (bs.signingOn && !screen.keyboardLocked) {
      if (!signOnUserField(screen)) this.onSignOn(bs, { outcome: 'signed-on' });
      else this.signOnUnknown(bs);
    }
    // A locked screen is the host still working; count the one the user gets.
    if (!screen.keyboardLocked) {
      this.opts.inventory?.record(bs.id, screen);
      // Signed off: with automatic sign-on, the next sign-on is on Veneer's page too.
      if (this.trackSignOn(bs, screen) && this.autoSignOn) return this.signedOff(bs);
    }
    bs.send({ type: 'screen', seq: ++bs.seq, screen, ...(bs.user ? { user: bs.user } : {}) });
  }

  /**
   * Leaving the sign-on screen means the submitted user signed on; returning
   * to it, signed off. Says whether a user just signed off.
   */
  private trackSignOn(bs: BrowserSession, screen: ScreenSnapshot): boolean {
    let signedOff = false;
    if (signOnUserField(screen)) {
      bs.shownDevice ??= displayName(screen);
      if (bs.user) log.info('signed off', { session: bs.id, user: bs.user });
      signedOff = bs.user !== undefined;
      bs.user = undefined;
    } else if (bs.pendingUser) {
      bs.user = bs.pendingUser;
      log.info('signed on', { session: bs.id, user: bs.user });
    }
    bs.pendingUser = undefined;
    return signedOff;
  }

  /** Back to Veneer's sign-on page, letting go of the host connection and its device. */
  private signedOff(bs: BrowserSession): void {
    this.dropHost(bs);
    bs.send({ type: 'signon', password: this.passwordRules });
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
    bs.host?.close();
    if (bs.deviceName) this.devices?.release(bs.deviceName);
    this.opts.inventory?.forget(bs.id);
    log.info('session closed', { session: bs.id, reason });
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((bs) => ({
      id: bs.id,
      user: bs.user ?? null,
      device: bs.deviceName ?? bs.shownDevice ?? null,
      remote: bs.remote,
      connectedAt: new Date(bs.createdAt).toISOString(),
      lastActivity: new Date(bs.lastActivity).toISOString(),
      hostConnected: bs.host?.connected ?? false,
      attached: bs.socket !== null,
      graceEndsAt: bs.graceEndsAt ? new Date(bs.graceEndsAt).toISOString() : null,
    }));
  }

  /** End a session from the admin page. Returns false if there is no such session. */
  end(id: string, by: string): boolean {
    const bs = [...this.sessions.values()].find((s) => s.id === id);
    if (!bs) return false;
    log.info('session ended by admin', { session: bs.id, by, ...(bs.user ? { user: bs.user } : {}) });
    bs.send({ type: 'error', message: 'Your session was ended by an administrator' });
    this.destroy(bs, CloseCode.ENDED_BY_ADMIN, 'Ended by an administrator');
    return true;
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

/** What a failed automatic sign-on's code (RFC 4777 section 10.4) means to the user. */
export function signOnError(code: string | undefined): string {
  switch (code) {
    case '0002': return 'There is no such user on this IBM i.';
    case '0003': return 'Your user profile is disabled. Ask your administrator to enable it.';
    case '0004': return 'The password is wrong.';
    case '0008': return 'The password is wrong. One more wrong password will disable your user profile.';
    case '0006': return 'Your password was set before V2R2. Ask your administrator to reset it.';
    case '8917': return 'You aren\'t authorized to the display device. Ask your administrator.';
    default: return `The IBM i didn't sign you on${code ? ` (code ${code})` : ''}. Try again, or ask your administrator.`;
  }
}

function rejectSocket(socket: WebSocket, message: string): void {
  socket.send(JSON.stringify({ type: 'error', message } satisfies ServerMessage));
  socket.close(CloseCode.POLICY_VIOLATION, 'Bad hello');
}

/**
 * Log a host record in hex. What the browser sends (field values, a password
 * among them, and the screen in Save Screen or Read Buffer replies) stays
 * out: an outbound record shows only its header and its AID and cursor.
 */
export function traceRecord(bs: { id: string }, dir: 'in' | 'out', rec: Buffer, host: HostType = '5250'): void {
  const shown = dir === 'in' ? rec : rec.subarray(0, Math.min(rec.length, keptOf(rec, host)));
  log.info('record', {
    session: bs.id, dir, length: rec.length, hex: shown.toString('hex'),
    ...(shown.length < rec.length ? { hidden: rec.length - shown.length } : {}),
  });
}

/** How much of an outbound record a trace may show. */
function keptOf(rec: Buffer, host: HostType): number {
  if (host === '5250') {
    // The GDS header (its variable part's length is byte 6), then cursor and AID.
    return 6 + (rec[6] ?? 4) + 3;
  }
  // 3270: a TN3270E header (data type 0x00-0x08; no AID is that low) of 5 bytes, if any.
  const header = rec[0] !== undefined && rec[0] <= 0x08 ? 5 : 0;
  // Only 3270 data has an AID and cursor; SSCP-LU data is typed text (a logon command, maybe a password).
  return header > 0 && rec[0] !== 0x00 ? header : header + 3;
}
