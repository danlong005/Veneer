// The host every browser session connects to: its settings, from VENEER_*
// environment variables, and the session that speaks its protocol. This is
// the only server code that knows there are two host types.

import fs from 'node:fs';
import { getCodepage, hostHasAid, isAidName, type AidName, type ConnectionSettings, type HostType, type TerminalSession } from '@veneer/terminal';
import { Session as Session3270, modelOf } from '@veneer/tn3270';
import { Session as Session5250, substituteFor, type AutoSignOn, type PasswordSubstitute } from '@veneer/tn5250';

// Automatic sign-on is IBM i's; the session code checks a sign-on with these.
export { USER_PROFILE, passwordProblem, type AutoSignOn } from '@veneer/tn5250';

export const HOST_TYPES: readonly HostType[] = ['5250', '3270'];

export interface HostSettings extends ConnectionSettings {
  /** IBM i (5250, the default) or mainframe (3270). */
  type?: HostType;
  /** Defaults: IBM-3179-2 (5250), IBM-3278-2-E (3270). */
  terminalType?: string;
  /** Host code page; default 37. */
  ccsid?: number;
  /** 3270 only: use TN3270E when the host offers it (default true). */
  tn3270e?: boolean;
  /**
   * 3270 only: the keys Page Up and Page Down send (default PF7 and PF8, the
   * usual convention); null when they send nothing.
   */
  pageKeys?: PageKeys | null;
  /**
   * IBM i only: sign users on from Veneer's own sign-on page, with the
   * password substitute the host's password level (QPWDLVL) checks.
   */
  autoSignOn?: { substitute: PasswordSubstitute };
}

/** What Page Up and Page Down send on a host without paging keys. */
export interface PageKeys {
  up: AidName;
  down: AidName;
}

export const DEFAULT_PAGE_KEYS: PageKeys = { up: 'F7', down: 'F8' };

/** The keys Page Up and Page Down send on this host: its own on a 5250, else the setting. */
export function pageKeysOf(settings: HostSettings): PageKeys | null {
  if (hostTypeOf(settings) === '5250') return { up: 'PageUp', down: 'PageDown' };
  return settings.pageKeys === undefined ? DEFAULT_PAGE_KEYS : settings.pageKeys;
}

/** The key to send for one pressed: Page Up and Page Down become the host's page keys. */
export function hostAid(settings: HostSettings, aid: AidName): AidName {
  if (aid !== 'PageUp' && aid !== 'PageDown') return aid;
  const keys = pageKeysOf(settings);
  return (keys && (aid === 'PageUp' ? keys.up : keys.down)) ?? aid;
}

/** What each session adds to the shared settings. */
export interface SessionExtras {
  /** Device (5250) or LU (3270) name to ask for. */
  deviceName?: string;
  onDeviceNameInUse?: (name: string) => string | undefined;
  /** 5250 only: sign on with these during negotiation. */
  autoSignOn?: AutoSignOn;
  trace?: (direction: 'in' | 'out', record: Buffer) => void;
}

export const hostTypeOf = (settings: HostSettings): HostType => settings.type ?? '5250';

/** The longest device name a host takes: 10 on IBM i, 8 for a VTAM LU. */
export const deviceNameLength = (type: HostType): number => (type === '3270' ? 8 : 10);

/** What people call the host in messages. */
export const hostLabel = (type: HostType): string => (type === '3270' ? 'the mainframe' : 'the IBM i');

export function defaultPort(settings: HostSettings): number {
  return settings.port ?? (settings.tls ? 992 : 23);
}

export function hostSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): HostSettings {
  if (!env.VENEER_HOST) throw new Error('VENEER_HOST is not set (see .env.example)');
  const type = (env.VENEER_HOST_TYPE || '5250') as HostType;
  if (!HOST_TYPES.includes(type)) throw new Error(`VENEER_HOST_TYPE must be 5250 or 3270, got "${env.VENEER_HOST_TYPE}"`);

  const port = env.VENEER_PORT ? Number(env.VENEER_PORT) : undefined;
  if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) {
    throw new Error(`VENEER_PORT is not a valid port: ${env.VENEER_PORT}`);
  }
  const useTls = (env.VENEER_TLS ?? 'true') !== 'false';

  const terminalType = env.VENEER_TERMINAL_TYPE || undefined;
  if (type === '3270' && terminalType) modelOf(terminalType); // throws for a type we can't be

  const ccsid = env.VENEER_CCSID ? Number(env.VENEER_CCSID) : undefined;
  if (ccsid !== undefined) {
    try {
      getCodepage(ccsid);
    } catch {
      throw new Error(`VENEER_CCSID ${env.VENEER_CCSID} is not supported: use 37 or 1047`);
    }
  }

  const tn3270e = env.VENEER_TN3270E ?? '';
  if (tn3270e !== '' && tn3270e !== 'true' && tn3270e !== 'false') throw new Error(`VENEER_TN3270E must be true or false, got "${tn3270e}"`);
  if (tn3270e !== '' && type !== '3270') throw new Error('VENEER_TN3270E is for 3270 hosts (VENEER_HOST_TYPE=3270)');

  const pageKeys = parsePageKeys(env.VENEER_PAGE_KEYS ?? '', type);
  const autoSignOn = parseSignOn(env, type);

  return {
    type,
    host: env.VENEER_HOST,
    ...(port !== undefined ? { port } : {}),
    tls: useTls && {
      rejectUnauthorized: env.VENEER_TLS_REJECT_UNAUTHORIZED !== 'false',
      ...(env.VENEER_TLS_CA ? { ca: fs.readFileSync(env.VENEER_TLS_CA) } : {}),
    },
    ...(terminalType ? { terminalType } : {}),
    ...(ccsid !== undefined ? { ccsid } : {}),
    ...(tn3270e === 'false' ? { tn3270e: false } : {}),
    ...(pageKeys !== undefined ? { pageKeys } : {}),
    ...(autoSignOn ? { autoSignOn } : {}),
  };
}

/**
 * VENEER_SIGNON=auto signs users on from Veneer's sign-on page. Telnet doesn't
 * say which password substitute the IBM i checks, so VENEER_QPWDLVL (the
 * system value QPWDLVL: 0 or 1 for DES, 2 or 3 for SHA-1) must say.
 */
function parseSignOn(env: NodeJS.ProcessEnv, type: HostType): HostSettings['autoSignOn'] {
  const mode = (env.VENEER_SIGNON ?? '').trim();
  const level = (env.VENEER_QPWDLVL ?? '').trim();
  if (mode === '' || mode === 'host') {
    if (level !== '') throw new Error('VENEER_QPWDLVL is for automatic sign-on (VENEER_SIGNON=auto)');
    return undefined;
  }
  if (mode !== 'auto') throw new Error(`VENEER_SIGNON must be auto or host, got "${env.VENEER_SIGNON}"`);
  if (type !== '5250') throw new Error('VENEER_SIGNON=auto is for IBM i hosts (VENEER_HOST_TYPE=5250)');
  if (!/^[0-3]$/.test(level)) {
    throw new Error(`VENEER_SIGNON=auto needs VENEER_QPWDLVL: the IBM i's QPWDLVL system value (0, 1, 2 or 3; DSPSYSVAL QPWDLVL shows it)${level ? `, got "${level}"` : ''}`);
  }
  return { substitute: substituteFor(Number(level)) };
}

/** VENEER_PAGE_KEYS: "PF7,PF8" (or "F7,F8"), "off", or blank for the default. */
function parsePageKeys(raw: string, type: HostType): PageKeys | null | undefined {
  const value = raw.trim();
  if (value === '') return undefined;
  if (type !== '3270') throw new Error('VENEER_PAGE_KEYS is for 3270 hosts (VENEER_HOST_TYPE=3270); a 5250 has its own page keys');
  if (value.toLowerCase() === 'off') return null;
  const keys = value.split(',').map((k) => k.trim().toUpperCase().replace(/^PF(?=\d)/, 'F'));
  const valid = (k: string | undefined): k is AidName => isAidName(k) && hostHasAid('3270', k) && k !== 'Clear';
  if (keys.length !== 2 || !valid(keys[0]) || !valid(keys[1])) {
    throw new Error(`VENEER_PAGE_KEYS must be two 3270 keys for Page Up and Page Down, such as PF7,PF8, or off; got "${raw}"`);
  }
  return { up: keys[0], down: keys[1] };
}

/** A session to the host, speaking its protocol. */
export function createHostSession(settings: HostSettings, extras: SessionExtras = {}): TerminalSession {
  const { type, tn3270e, pageKeys: _pageKeys, autoSignOn: _autoSignOn, ...common } = settings;
  if ((type ?? '5250') === '3270') {
    const { autoSignOn: _signOn, ...rest } = extras;
    return new Session3270({ ...common, ...(tn3270e === false ? { tn3270e } : {}), ...rest });
  }
  return new Session5250({ ...common, ...extras });
}
