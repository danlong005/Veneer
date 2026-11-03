// A tiny fake IBM i: negotiates TN5250, shows a sign-on screen, and shows a
// menu after Enter. Records every inbound 5250 record. Like IBM i, it asks
// for another DEVNAME when the one sent is in use, and hangs up if none comes.

import net from 'node:net';
import { buildRecord, getCodepage, passwordSubstitute, type PasswordSubstitute } from '@veneer/tn5250';
import { environmentVars, startupRecord } from '../dev/demoHost.ts';

const cp = getCodepage(37);
const e = (s: string) => cp.encode(s);
const IAC = 0xff;

export const SIGN_ON = [
  0x04, 0x40, // clear unit
  0x04, 0x11, 0x00, 0x08, // WTD, unlock keyboard
  0x11, 1, 35, 0x22, ...e('Sign On'), 0x20,
  0x11, 3, 48, ...e('Display . . . :   QPADEV0042'),
  0x11, 6, 17, ...e('User'),
  0x11, 6, 52, 0x1d, 0x40, 0x20, 0x24, 0, 10, 0x11, 6, 63, 0x20,
  0x11, 7, 17, ...e('Password'),
  0x11, 7, 52, 0x1d, 0x40, 0x20, 0x27, 0, 10, 0x11, 7, 63, 0x20,
  0x13, 6, 53,
  0x04, 0x52, 0x00, 0x00, // read MDT fields
];

export const MAIN_MENU = [
  0x04, 0x40,
  0x04, 0x11, 0x00, 0x08,
  0x11, 1, 2, 0x22, ...e('MAIN'), 0x20, 0x11, 1, 30, ...e('IBM i Main Menu'),
  0x11, 20, 2, ...e('Selection or command'),
  0x11, 21, 1, 0x1d, 0x40, 0x00, 0x24, 0, 60, 0x11, 21, 62, 0x20,
  0x04, 0x52, 0x00, 0x00,
];

/**
 * Automatic sign-on, as IBM i does it: the host sends a seed, checks the
 * substitute it gets back, and says how it went in a Startup Response Record.
 * `refuse` is QRMTSIGN *FRCSIGNON (I906); `no-seed` a host that offers no
 * seed; `no-record` one that sends no Startup Response Record.
 */
export interface FakeSignOn {
  substitute: PasswordSubstitute;
  users: Record<string, { password: string; status?: 'disabled' | 'expired' }>;
  mode?: 'verify' | 'refuse' | 'no-seed' | 'no-record';
}

/** The fake host's seed: has an ESC byte (0x02) and an IAC (0xff), which must be escaped. */
export const SERVER_SEED = Buffer.from([0x7d, 0x02, 0x48, 0xff, 0x18, 0x08, 0x04, 0x04]);

export class FakeHost {
  /** The NEW-ENVIRON variables each connection sent, by name (values as raw bytes). */
  readonly environments: Array<Record<string, Buffer>> = [];
  /** Startup Response Record codes sent. */
  readonly startupCodes: string[] = [];
  signOn: FakeSignOn | undefined;
  private readonly signedOn = new Map<net.Socket, string>();
  private readonly envOf = new Map<net.Socket, Record<string, Buffer>>();

  readonly server = net.createServer((s) => this.onConnection(s));
  readonly records: Buffer[] = [];
  readonly sockets = new Set<net.Socket>();
  /** DEVNAME values clients sent via NEW-ENVIRON, in connection order. */
  readonly deviceNames: Array<string | null> = [];
  /** Device names held by jobs outside the test (leftovers, other emulators). */
  readonly heldNames = new Set<string>();
  private readonly devices = new Map<net.Socket, string | null>();
  connections = 0;

  async start(): Promise<number> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    return (this.server.address() as net.AddressInfo).port;
  }

  stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    return new Promise((r) => this.server.close(() => r()));
  }

  private onConnection(socket: net.Socket): void {
    this.connections++;
    this.sockets.add(socket);
    socket.on('close', () => { this.sockets.delete(socket); this.devices.delete(socket); });
    socket.on('error', () => {});
    socket.write(Buffer.from([IAC, 0xfd, 0x18, IAC, 0xfd, 0x19, IAC, 0xfb, 0x19, IAC, 0xfd, 0x00, IAC, 0xfb, 0x00]));
    // Ask for environment variables (DEVNAME, and with a seed for sign-on), as IBM i does.
    const seed = this.signOn && this.signOn.mode !== 'no-seed'
      ? [0x03, ...Buffer.from('IBMRSEED'), ...[...SERVER_SEED].flatMap((b) => (b <= 3 ? [0x02, b] : b === IAC ? [IAC, IAC] : [b])), 0x03, ...Buffer.from('IBMSUBSPW')]
      : [];
    socket.write(Buffer.from([IAC, 0xfd, 0x27, IAC, 0xfa, 0x27, 0x01, ...seed, 0x00, 0x03, IAC, 0xf0]));
    let retried = false;

    let pending: number[] = [];
    let sub: number[] = [];
    let skip = 0;
    let inSub = false;
    let iac = false;
    socket.on('data', (chunk) => {
      for (const b of chunk) {
        if (skip > 0) { skip--; continue; }
        if (iac) {
          iac = false;
          if (b === IAC) { if (inSub) sub.push(b); else pending.push(b); }
          else if (b === 0xef) { this.onRecord(socket, Buffer.from(pending)); pending = []; }
          else if (b >= 0xfb && b <= 0xfe) skip = 1;
          else if (b === 0xfa) { inSub = true; sub = []; }
          else if (b === 0xf0) {
            inSub = false;
            const name = this.onSub(sub, socket);
            if (name === undefined) continue;
            if (name !== null && this.inUse(name, socket)) {
              retried = true;
              socket.write(Buffer.from([IAC, 0xfa, 0x27, 0x01, 0x03, ...Buffer.from('DEVNAME'), IAC, 0xf0]));
            } else if (name === null && retried) {
              socket.destroy();
            } else {
              this.devices.set(socket, name);
              this.ready(socket, name);
            }
          }
          continue;
        }
        if (b === IAC) iac = true;
        else if (inSub) sub.push(b);
        else pending.push(b);
      }
    });
  }

  /** NEW-ENVIRON IS [USERVAR "DEVNAME" VALUE "..."]: the name, null for none, undefined if not that. */
  private onSub(sub: number[], socket: net.Socket): string | null | undefined {
    if (sub[0] !== 0x27 || sub[1] !== 0x00) return undefined;
    const env = environmentVars(sub.slice(2));
    this.environments.push(env);
    this.envOf.set(socket, env);
    const text = Buffer.from(sub.slice(2)).toString('latin1');
    const m = /\x03DEVNAME\x01([^\x00-\x03]*)/.exec(text);
    const name = m ? m[1]! : null;
    this.deviceNames.push(name);
    return name;
  }

  /** The device is ready: sign on if asked to, then show the menu, or else the sign-on screen. */
  private ready(socket: net.Socket, device: string | null): void {
    const env = this.envOf.get(socket) ?? {};
    const user = env.USER?.toString('latin1');
    const config = this.signOn;
    if (!config || !user) return send(socket, SIGN_ON);
    const code = this.check(config, user, env);
    // Like IBM i, a Startup Response Record only for a client that asks for one.
    if (config.mode !== 'no-record' && env.IBMSENDCONFREC?.toString() === 'YES') this.startup(socket, code, device ?? 'QPADEV0042');
    if (code === 'I902') {
      this.signedOn.set(socket, user);
      send(socket, MAIN_MENU);
    } else {
      send(socket, SIGN_ON);
    }
  }

  private check(config: FakeSignOn, user: string, env: Record<string, Buffer>): string {
    if (config.mode === 'refuse' || config.mode === 'no-seed') return 'I906';
    const profile = config.users[user];
    if (!profile) return '0002';
    if (profile.status === 'disabled') return '0003';
    const clientSeed = env.IBMRSEED;
    if (!clientSeed || clientSeed.length !== 8) return '0004';
    const expected = passwordSubstitute(config.substitute, user, profile.password, SERVER_SEED, clientSeed);
    if (!env.IBMSUBSPW?.equals(expected)) return '0004';
    return profile.status === 'expired' ? '0005' : 'I902';
  }

  /** A Startup Response Record (RFC 4777 section 10). */
  private startup(socket: net.Socket, code: string, device: string): void {
    this.startupCodes.push(code);
    socket.write(startupRecord(code, 'FAKEIBMI', device));
  }

  /** Who signed on automatically on a connection still open. */
  get signedOnUsers(): string[] {
    return [...this.signedOn].filter(([s]) => !s.destroyed).map(([, u]) => u);
  }

  private inUse(name: string, socket: net.Socket): boolean {
    if (this.heldNames.has(name)) return true;
    return [...this.devices].some(([s, n]) => s !== socket && n === name);
  }

  private onRecord(socket: net.Socket, rec: Buffer): void {
    this.records.push(rec);
    if (rec[9] === 0x03 && rec[12] === 0xf1) send(socket, MAIN_MENU); // Enter
    // F3: sign off, and like IBM i keep the connection, showing the sign-on screen again.
    if (rec[9] === 0x03 && rec[12] === 0x33) { this.signedOn.delete(socket); send(socket, SIGN_ON); }
    // SysReq: like IBM i, withdraw the pending Read (the System Request menu would follow).
    if (rec[9] === 0x00 && (rec[7]! & 0x04) !== 0) send(socket, [], 0x0a);
  }
}

function send(socket: net.Socket, data: number[], opcode = 0x03): void {
  const rec = buildRecord(opcode, data);
  const out: number[] = [];
  for (const b of rec) { out.push(b); if (b === IAC) out.push(IAC); }
  socket.write(Buffer.from([...out, IAC, 0xef]));
}

