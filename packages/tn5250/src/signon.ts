// Automatic sign-on (RFC 4777 section 5): the password substitute a client
// sends instead of the password, built from it, the user profile and two
// random seeds, and the Startup Response Record that says how it went.
//
// IBM i checks a DES-based substitute at password levels (QPWDLVL) 0 and 1,
// and a SHA-1-based one at 2 and 3. Telnet doesn't say which level a host
// uses, so the client is told.

import { createCipheriv, createHash } from 'node:crypto';
import { getCodepage, type SignOnResult } from '@veneer/terminal';

/** Which password substitute the host checks: DES at QPWDLVL 0 and 1, SHA-1 at 2 and 3. */
export type PasswordSubstitute = 'des' | 'sha';

export const substituteFor = (passwordLevel: number): PasswordSubstitute => (passwordLevel >= 2 ? 'sha' : 'des');

/** User profiles: up to 10 of A-Z, 0-9, #, $, @ and _, not starting with a digit or _. */
export const USER_PROFILE = /^[A-Z#$@][A-Z0-9#$@_]{0,9}$/;

/** What a password may be at each level: up to 10 characters (DES, uppercase) or 128 (SHA). */
export function passwordProblem(password: string, substitute: PasswordSubstitute): string | undefined {
  if (password.length === 0) return 'Type your password.';
  if (substitute === 'sha') return password.length > 128 ? 'A password is at most 128 characters.' : undefined;
  if (password.length > 10) return 'A password is at most 10 characters on this IBM i.';
  if (!/^[A-Za-z0-9#$@_]+$/.test(password)) return 'A password on this IBM i is letters, digits, #, $, @ and _.';
  return undefined;
}

const SEQUENCE = Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]); // PWSEQs: always 1 for Telnet

/**
 * The DES password substitute (RFC 4777 section 5.1): 8 bytes. The user
 * profile and password (at most 10 characters each) are uppercased and
 * converted to EBCDIC.
 */
export function desSubstitute(user: string, password: string, serverSeed: Uint8Array, clientSeed: Uint8Array): Buffer {
  const id = ebcdic(user, 10);
  const pw = ebcdic(password, 10);
  if (id.length < 1 || id.length > 10) throw new RangeError('A user profile is 1 to 10 characters');
  if (pw.length < 1 || pw.length > 10) throw new RangeError('A DES password is 1 to 10 characters');
  // Steps 1-4: PW_TOKEN, from two halves for a password of 9 or 10 characters.
  const token = pw.length <= 8
    ? pwToken(pw, id)
    : xor(pwToken(pw.subarray(0, 8), id), pwToken(pw.subarray(8), id));
  // Steps 5-7.
  const rdrSeq = add64(seed(serverSeed), SEQUENCE);
  const id16 = pad(id, 16);
  const data = Buffer.concat([rdrSeq, seed(clientSeed), xor(id16.subarray(0, 8), rdrSeq), xor(id16.subarray(8), rdrSeq), SEQUENCE]);
  const cbc = des('des-ede-cbc', token, data);
  return cbc.subarray(cbc.length - 8);
}

/**
 * The SHA-1 password substitute (RFC 4777 section 5.2): 20 bytes. The user
 * profile is uppercased; the password is used as typed (case matters).
 */
export function shaSubstitute(user: string, password: string, serverSeed: Uint8Array, clientSeed: Uint8Array): Buffer {
  const name = user.toUpperCase();
  if (name.length < 1 || name.length > 10) throw new RangeError('A user profile is 1 to 10 characters');
  if (password.length < 1 || password.length > 128) throw new RangeError('A password is 1 to 128 characters');
  const id = utf16be(name.padEnd(10, ' '));
  const token = createHash('sha1').update(id).update(utf16be(password)).digest();
  return createHash('sha1').update(token).update(seed(serverSeed)).update(seed(clientSeed)).update(id).update(SEQUENCE).digest();
}

export function passwordSubstitute(kind: PasswordSubstitute, user: string, password: string, serverSeed: Uint8Array, clientSeed: Uint8Array): Buffer {
  return (kind === 'des' ? desSubstitute : shaSubstitute)(user, password, serverSeed, clientSeed);
}

/** Steps 1-4: the padded password, XORed with 55s and shifted left a bit, is the key that encrypts the user ID. */
function pwToken(pw: Buffer, id: Buffer): Buffer {
  const key = Buffer.from(pad(pw, 8).map((b) => b ^ 0x55));
  for (let i = 0; i < 8; i++) key[i] = ((key[i]! << 1) | (i < 7 ? key[i + 1]! >> 7 : 0)) & 0xff;
  return des('des-ede-ecb', key, foldedId(id));
}

/** The user ID (EBCDIC) in 8 bytes: bytes 9 and 10, two bits at a time, are XORed into the top bits of bytes 1-8. */
export function foldedId(id: Buffer): Buffer {
  const out = pad(id.subarray(0, 8), 8);
  if (id.length <= 8) return out;
  const extra = pad(id.subarray(8), 2);
  for (let i = 0; i < 8; i++) {
    const bits = (extra[i >> 2]! >> (6 - 2 * (i & 3))) & 0x03;
    out[i] = out[i]! ^ (bits << 6);
  }
  return out;
}

/** Single DES, as two-key triple DES with both keys the same (OpenSSL 3 keeps plain DES in its legacy provider). */
function des(mode: 'des-ede-ecb' | 'des-ede-cbc', key: Buffer, data: Buffer): Buffer {
  const cipher = createCipheriv(mode, Buffer.concat([key, key]), mode === 'des-ede-cbc' ? Buffer.alloc(8) : null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

function ebcdic(s: string, max: number): Buffer {
  return Buffer.from(getCodepage(37).encode(s.toUpperCase().slice(0, max + 1)));
}

function pad(b: Uint8Array, length: number): Buffer {
  const out = Buffer.alloc(length, 0x40);
  out.set(b.subarray(0, length));
  return out;
}

function xor(a: Uint8Array, b: Uint8Array): Buffer {
  return Buffer.from(a.map((x, i) => x ^ b[i]!));
}

/** a + b as unsigned 64-bit big-endian numbers, wrapping. */
function add64(a: Buffer, b: Buffer): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64BE((a.readBigUInt64BE() + b.readBigUInt64BE()) & 0xffffffffffffffffn);
  return out;
}

function seed(s: Uint8Array): Buffer {
  if (s.length !== 8) throw new RangeError('A seed is 8 bytes');
  return Buffer.from(s);
}

function utf16be(s: string): Buffer {
  const le = Buffer.from(s, 'utf16le');
  return le.swap16();
}

// ---------------------------------------------------------------- Startup Response Record

/** What the host said about starting the session (RFC 4777 section 10). */
export interface StartupResponse {
  /** I902 started; I906 auto sign-on not allowed; 0001-0008 sign-on errors; 8xxx device errors. */
  code: string;
  /** The IBM i's name. */
  system?: string;
  /** The device the session got. */
  device?: string;
}

/**
 * A Startup Response Record, if this record is one: a 5250 record whose
 * reserved bytes are 9000, with a 4-character code at offset 16, then the
 * system and device names.
 */
export function startupResponse(rec: Uint8Array): StartupResponse | undefined {
  if (rec.length < 20 || rec[2] !== 0x12 || rec[3] !== 0xa0 || rec[4] !== 0x90 || rec[5] !== 0x00) return undefined;
  const cp = getCodepage(37);
  const text = (from: number, to: number) => (rec.length >= to ? cp.decode(rec.subarray(from, to)).replace(/\0/g, '').trim() : '');
  const code = text(16, 20);
  if (!/^[0-9A-Z]{4}$/.test(code)) return undefined;
  const system = text(20, 28);
  const device = text(28, 38);
  return { code, ...(system ? { system } : {}), ...(device ? { device } : {}) };
}

/** What a Startup Response Record's code says about an automatic sign-on; undefined if nothing (a device error, say). */
export function signOnOutcome(code: string): SignOnResult['outcome'] | undefined {
  if (code === 'I902' || code === 'I901') return 'signed-on';
  if (code === 'I906' || code === '8937') return 'not-allowed';
  if (code === '0005') return 'expired';
  if (['0001', '0002', '0003', '0004', '0006', '0008', '8917', '8936'].includes(code)) return 'rejected';
  return undefined;
}
