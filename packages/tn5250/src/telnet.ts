// Telnet framing and option negotiation for TN5250 (RFC 1205 / 2877 / 4777).
// Transport-agnostic: feed received bytes to receive(), and outbound bytes
// are handed to the `send` callback.

import { Sub, Telnet, TelnetOption } from './constants.ts';

export interface TelnetOptions {
  /** e.g. IBM-3179-2 (24x80) or IBM-3477-FC (27x132). */
  terminalType: string;
  /** Requested virtual device name; omit to let the host assign one. */
  deviceName?: string | undefined;
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

  constructor(opts: TelnetOptions) {
    this.opts = opts;
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
      const body: number[] = [Sub.IS];
      if (this.opts.deviceName) {
        body.push(Sub.USERVAR, ...ascii('DEVNAME'), Sub.VALUE, ...ascii(this.opts.deviceName));
      }
      this.sendSub(TelnetOption.NEW_ENVIRON, body);
    }
  }

  private sendSub(option: number, body: number[]): void {
    const escaped = body.flatMap((b) => (b === Telnet.IAC ? [b, b] : [b]));
    this.opts.send(Buffer.from([Telnet.IAC, Telnet.SB, option, ...escaped, Telnet.IAC, Telnet.SE]));
  }
}

function ascii(s: string): number[] {
  return [...Buffer.from(s, 'ascii')];
}
