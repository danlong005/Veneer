// A tiny fake IBM i: negotiates TN5250, shows a sign-on screen, and shows a
// menu after Enter. Records every inbound 5250 record.

import net from 'node:net';
import { buildRecord, getCodepage } from '@veneer/tn5250';

const cp = getCodepage(37);
const e = (s: string) => cp.encode(s);
const IAC = 0xff;

export const SIGN_ON = [
  0x04, 0x40, // clear unit
  0x04, 0x11, 0x00, 0x08, // WTD, unlock keyboard
  0x11, 1, 35, 0x22, ...e('Sign On'), 0x20,
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

export class FakeHost {
  readonly server = net.createServer((s) => this.onConnection(s));
  readonly records: Buffer[] = [];
  readonly sockets = new Set<net.Socket>();
  /** DEVNAME values clients sent via NEW-ENVIRON, in connection order. */
  readonly deviceNames: Array<string | null> = [];
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
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => {});
    socket.write(Buffer.from([IAC, 0xfd, 0x18, IAC, 0xfd, 0x19, IAC, 0xfb, 0x19, IAC, 0xfd, 0x00, IAC, 0xfb, 0x00]));
    // Ask for environment variables (DEVNAME), as IBM i does.
    socket.write(Buffer.from([IAC, 0xfd, 0x27, IAC, 0xfa, 0x27, 0x01, 0x03, IAC, 0xf0]));
    send(socket, SIGN_ON);

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
          else if (b === 0xf0) { inSub = false; this.onSub(sub); }
          continue;
        }
        if (b === IAC) iac = true;
        else if (inSub) sub.push(b);
        else pending.push(b);
      }
    });
  }

  /** NEW-ENVIRON IS [USERVAR "DEVNAME" VALUE "..."] */
  private onSub(sub: number[]): void {
    if (sub[0] !== 0x27 || sub[1] !== 0x00) return;
    const text = Buffer.from(sub.slice(2)).toString('latin1');
    const m = /\x03DEVNAME\x01([^\x00-\x03]*)/.exec(text);
    this.deviceNames.push(m ? m[1]! : null);
  }

  private onRecord(socket: net.Socket, rec: Buffer): void {
    this.records.push(rec);
    if (rec[9] === 0x03 && rec[12] === 0xf1) send(socket, MAIN_MENU); // Enter
  }
}

function send(socket: net.Socket, data: number[]): void {
  const rec = buildRecord(0x03, data);
  const out: number[] = [];
  for (const b of rec) { out.push(b); if (b === IAC) out.push(IAC); }
  socket.write(Buffer.from([...out, IAC, 0xef]));
}
