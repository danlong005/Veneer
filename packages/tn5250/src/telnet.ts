// Telnet framing and option negotiation for TN5250 (RFC 1205 / 2877 / 4777).
// Transport-agnostic: feed received bytes to receive(), and outbound bytes
// are handed to the `send` callback.

import { randomBytes } from 'node:crypto';
import { Sub, Telnet, TelnetOption } from './constants.ts';
import { passwordSubstitute, type PasswordSubstitute } from './signon.ts';

/** Sign on during negotiation (RFC 4777 section 5) instead of on the sign-on screen. */
export interface AutoSignOn {
  user: string;
  password: string;
  /** DES at QPWDLVL 0 and 1, SHA-1 at 2 and 3. */
  substitute: PasswordSubstitute;
  /** Program to call, initial menu and current library, instead of the user profile's. */
  program?: string | undefined;
  menu?: string | undefined;
  library?: string | undefined;
}

export interface TelnetOptions {
  /** e.g. IBM-3179-2 (24x80) or IBM-3477-FC (27x132). */
  terminalType: string;
  /** Requested virtual device name; omit to let the host assign one. */
  deviceName?: string | undefined;
  /**
   * Called when the host asks for DEVNAME again, which means the name sent is
   * in use: IBM i first checks the session holding it is alive (it sends that
   * session DO TIMING-MARK), then asks for another name on this connection.
   * Return another name to try, or undefined to give up (the host then closes
   * the connection; answering with no name does not get a QPADEV device).
   */
  onDeviceNameInUse?: ((name: string) => string | undefined) | undefined;
  /**
   * Sign on with these. The password is turned into a substitute when the
   * host sends its seed, and dropped; it is never sent. A host that sends no
   * seed doesn't get the user either (see autoSignOnOffered).
   */
  autoSignOn?: AutoSignOn | undefined;
  /** For tests: the client's seed (default: 8 random bytes). */
  clientSeed?: (() => Buffer) | undefined;
  send: (bytes: Buffer) => void;
  onRecord: (record: Buffer) => void;
}

const SUPPORTED_LOCAL = new Set<number>([
  TelnetOption.BINARY, TelnetOption.TERMINAL_TYPE, TelnetOption.EOR, TelnetOption.NEW_ENVIRON,
]);
const SUPPORTED_REMOTE = new Set<number>([TelnetOption.BINARY, TelnetOption.EOR]);

const State = { Data: 0, Iac: 1, Will: 2, Wont: 3, Do: 4, Dont: 5, Sb: 6, SbIac: 7 } as const;
type State = (typeof State)[keyof typeof State];

export class TelnetCodec {
  private readonly opts: TelnetOptions;
  private state: State = State.Data;
  private record: number[] = [];
  private sub: number[] = [];
  private readonly localOn = new Set<number>();
  private readonly remoteOn = new Set<number>();
  /** The device name last sent to the host. */
  private sentDeviceName: string | undefined;
  /** The last name the host refused when no other was offered. */
  private refused: string | undefined;
  /** Until the host's seed comes: what to sign on with. */
  private signOn: AutoSignOn | undefined;
  /** After: the sign-on variables to send, the password only as its substitute. */
  private signOnVars: number[] | undefined;
  private offered: boolean | undefined;

  constructor(opts: TelnetOptions) {
    const { autoSignOn, ...rest } = opts;
    this.opts = rest;
    this.signOn = autoSignOn;
  }

  /**
   * Whether the host took part in automatic sign-on: true once it sent a seed
   * and got the substitute, false if it asked for variables without one;
   * undefined before it asked, or with no sign-on to do.
   */
  get autoSignOnOffered(): boolean | undefined {
    return this.offered;
  }

  receive(chunk: Uint8Array): void {
    for (const b of chunk) {
      switch (this.state) {
        case State.Data:
          if (b === Telnet.IAC) this.state = State.Iac;
          else this.record.push(b);
          break;
        case State.Iac:
          this.state = State.Data;
          if (b === Telnet.IAC) this.record.push(0xff);
          else if (b === Telnet.EOR) this.flushRecord();
          else if (b === Telnet.WILL) this.state = State.Will;
          else if (b === Telnet.WONT) this.state = State.Wont;
          else if (b === Telnet.DO) this.state = State.Do;
          else if (b === Telnet.DONT) this.state = State.Dont;
          else if (b === Telnet.SB) { this.sub = []; this.state = State.Sb; }
          // Other commands (NOP, GA, ...) are ignored.
          break;
        case State.Will: this.state = State.Data; this.onWill(b); break;
        case State.Wont: this.state = State.Data; this.onWont(b); break;
        case State.Do: this.state = State.Data; this.onDo(b); break;
        case State.Dont: this.state = State.Data; this.onDont(b); break;
        case State.Sb:
          if (b === Telnet.IAC) this.state = State.SbIac;
          else this.sub.push(b);
          break;
        case State.SbIac:
          if (b === Telnet.SE) { this.state = State.Data; this.onSubnegotiation(this.sub); }
          else { this.sub.push(b); this.state = State.Sb; }
          break;
      }
    }
  }

  /** The device name last requested from the host. */
  get deviceName(): string | undefined {
    return this.sentDeviceName;
  }

  /** The device name the host refused when there was no other to offer. */
  get refusedDeviceName(): string | undefined {
    return this.refused;
  }

  /** Send one 5250 record, escaping IAC and terminating with IAC EOR. */
  sendRecord(record: Uint8Array): void {
    const out: number[] = [];
    for (const b of record) {
      out.push(b);
      if (b === Telnet.IAC) out.push(Telnet.IAC);
    }
    out.push(Telnet.IAC, Telnet.EOR);
    this.opts.send(Buffer.from(out));
  }

  private flushRecord(): void {
    const rec = Buffer.from(this.record);
    this.record = [];
    if (rec.length > 0) this.opts.onRecord(rec);
  }

  private reply(verb: number, option: number): void {
    this.opts.send(Buffer.from([Telnet.IAC, verb, option]));
  }

  private onDo(option: number): void {
    if (!SUPPORTED_LOCAL.has(option)) return this.reply(Telnet.WONT, option);
    if (this.localOn.has(option)) return;
    this.localOn.add(option);
    this.reply(Telnet.WILL, option);
  }

  private onDont(option: number): void {
    if (!this.localOn.delete(option)) return;
    this.reply(Telnet.WONT, option);
  }

  private onWill(option: number): void {
    if (!SUPPORTED_REMOTE.has(option)) return this.reply(Telnet.DONT, option);
    if (this.remoteOn.has(option)) return;
    this.remoteOn.add(option);
    this.reply(Telnet.DO, option);
  }

  private onWont(option: number): void {
    if (!this.remoteOn.delete(option)) return;
    this.reply(Telnet.DONT, option);
  }

  private onSubnegotiation(data: number[]): void {
    const [option, verb] = data;
    if (verb !== Sub.SEND) return;
    if (option === TelnetOption.TERMINAL_TYPE) {
      this.sendSub(TelnetOption.TERMINAL_TYPE, [Sub.IS, ...ascii(this.opts.terminalType)]);
    } else if (option === TelnetOption.NEW_ENVIRON) {
      // Asked again after we sent a name: that name is in use.
      const retry = this.sentDeviceName !== undefined;
      const name = (retry ? this.opts.onDeviceNameInUse?.(this.sentDeviceName!) : this.opts.deviceName) || undefined;
      if (retry && !name) this.refused = this.sentDeviceName;
      this.sentDeviceName = name;
      this.prepareSignOn(data.slice(2));
      const body: number[] = [Sub.IS];
      if (this.signOnVars) body.push(...this.signOnVars);
      if (name) body.push(Sub.USERVAR, ...ascii('DEVNAME'), Sub.VALUE, ...ascii(name));
      this.sendSub(TelnetOption.NEW_ENVIRON, body);
    }
  }

  /**
   * Build the sign-on variables from the seed the host asks with
   * (USERVAR "IBMRSEED" followed by its 8-byte seed), once.
   */
  private prepareSignOn(request: number[]): void {
    const signOn = this.signOn;
    if (!signOn) return;
    this.signOn = undefined;
    const serverSeed = requestedSeed(request);
    this.offered = serverSeed !== undefined;
    if (!serverSeed) return;
    const clientSeed = this.opts.clientSeed?.() ?? randomBytes(8);
    const substitute = passwordSubstitute(signOn.substitute, signOn.user, signOn.password, serverSeed, clientSeed);
    const vars: number[] = [Sub.VAR, ...ascii('USER'), Sub.VALUE, ...ascii(signOn.user.toUpperCase())];
    vars.push(Sub.USERVAR, ...ascii('IBMRSEED'), Sub.VALUE, ...escapeValue(clientSeed));
    vars.push(Sub.USERVAR, ...ascii('IBMSUBSPW'), Sub.VALUE, ...escapeValue(substitute));
    const extra: Array<[string, string | undefined]> = [['IBMPROGRAM', signOn.program], ['IBMIMENU', signOn.menu], ['IBMCURLIB', signOn.library]];
    for (const [key, value] of extra) if (value) vars.push(Sub.USERVAR, ...ascii(key), Sub.VALUE, ...ascii(value.toUpperCase()));
    // Ask for the Startup Response Record, which says whether sign-on worked.
    vars.push(Sub.USERVAR, ...ascii('IBMSENDCONFREC'), Sub.VALUE, ...ascii('YES'));
    this.signOnVars = vars;
  }

  private sendSub(option: number, body: number[]): void {
    const escaped = body.flatMap((b) => (b === Telnet.IAC ? [b, b] : [b]));
    this.opts.send(Buffer.from([Telnet.IAC, Telnet.SB, option, ...escaped, Telnet.IAC, Telnet.SE]));
  }
}

/**
 * The server seed in a NEW-ENVIRON SEND: the 8 bytes after USERVAR "IBMRSEED".
 * A byte that is a NEW-ENVIRON code (0-3) comes after ESC.
 */
export function requestedSeed(request: number[]): Buffer | undefined {
  const name = ascii('IBMRSEED');
  for (let i = 0; i < request.length; i++) {
    if (request[i] !== Sub.USERVAR || !name.every((b, k) => request[i + 1 + k] === b)) continue;
    const seed: number[] = [];
    for (let j = i + 1 + name.length; j < request.length && seed.length < 8; j++) {
      let b = request[j]!;
      if (b === Sub.ESC && j + 1 < request.length) b = request[++j]!;
      else if (b <= Sub.USERVAR) break;
      seed.push(b);
    }
    return seed.length === 8 ? Buffer.from(seed) : undefined;
  }
  return undefined;
}

/** A binary value in NEW-ENVIRON: bytes that are its codes (VAR, VALUE, ESC, USERVAR) go after ESC. */
function escapeValue(bytes: Uint8Array): number[] {
  return [...bytes].flatMap((b) => (b <= Sub.USERVAR ? [Sub.ESC, b] : [b]));
}

function ascii(s: string): number[] {
  return [...Buffer.from(s, 'ascii')];
}
