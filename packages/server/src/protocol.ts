// Messages exchanged between the browser and the Veneer server over /ws.

import { isAidName, type AidName, type ScreenSnapshot } from '@veneer/terminal';

export type ServerMessage =
  /** First message on every socket. Keep `resumeToken` to reattach after a reload. */
  | { type: 'hello'; sessionId: string; resumeToken: string; resumed: boolean }
  | { type: 'status'; state: 'connecting' | 'connected' | 'closed'; message?: string }
  /** `seq` increases with every screen sent for this session. `user` is who signed on, once known. */
  | { type: 'screen'; seq: number; screen: ScreenSnapshot; user?: string }
  | { type: 'error'; message: string }
  /**
   * Automatic sign-on: show Veneer's sign-on page (again, with `error`, after
   * a failure). `password` says what the IBM i's password level allows.
   */
  | { type: 'signon'; password: PasswordRules; error?: string }
  /** Something the user should know that isn't an error, e.g. why the host's sign-on screen is showing. */
  | { type: 'notice'; message: string }
  /** Screen definitions changed; refetch /api/screens. */
  | { type: 'screens'; version: number };

export type ClientMessage =
  /** Must be the first message. Pass the last resumeToken to reattach to a live session. */
  | { type: 'hello'; resumeToken?: string }
  | { type: 'submit'; aid: AidName; fields?: Record<string, string>; cursor?: { row: number; col: number } }
  | { type: 'reset' }
  | { type: 'sysreq' }
  | { type: 'attn' }
  /** Ends the host session now instead of waiting for the resume grace period. */
  | { type: 'disconnect' }
  /** Automatic sign-on, after a signon message. The password is used for the substitute and dropped. */
  | { type: 'signon'; user: string; password: string; program?: string; menu?: string; library?: string }
  /** How a macro run ended, for the log (never its parameter values). `step` counts from 1. */
  | { type: 'macro'; macro: string; outcome: MacroOutcome; step?: number };

/** Passwords at QPWDLVL 0 and 1: up to 10 characters, any case; at 2 and 3, up to 128, case-sensitive. */
export interface PasswordRules {
  maxLength: number;
  caseSensitive: boolean;
}

/** The optional things a sign-on can ask for: an IBM i object name each. */
export const SIGN_ON_EXTRAS = ['program', 'menu', 'library'] as const;

export const MACRO_OUTCOMES = ['done', 'failed', 'cancelled'] as const;
export type MacroOutcome = (typeof MACRO_OUTCOMES)[number];

/** WebSocket close codes used by the server. */
export const CloseCode = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  POLICY_VIOLATION: 1008,
  IDLE_TIMEOUT: 4001,
  HOST_CLOSED: 4002,
  SESSION_LIMIT: 4003,
  REPLACED: 4004,
  ENDED_BY_ADMIN: 4005,
} as const;

const MAX_FIELDS = 512;
const MAX_FIELD_LENGTH = 3564; // 27 x 132

/** Parse and validate a client message. Throws with a client-safe message on bad input. */
export function parseClientMessage(raw: string): ClientMessage {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    throw new Error('Message is not valid JSON');
  }
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) throw new Error('Message must be an object');
  const m = msg as Record<string, unknown>;
  switch (m.type) {
    case 'hello':
      if (m.resumeToken === undefined) return { type: 'hello' };
      if (typeof m.resumeToken !== 'string' || m.resumeToken.length > 128) {
        throw new Error('hello.resumeToken must be a string');
      }
      return { type: 'hello', resumeToken: m.resumeToken };
    case 'reset':
    case 'sysreq':
    case 'attn':
    case 'disconnect':
      return { type: m.type };
    case 'signon': {
      const str = (v: unknown, name: string, max: number) => {
        if (typeof v !== 'string' || v.length > max) throw new Error(`signon.${name} must be a string of at most ${max} characters`);
        return v;
      };
      const out: ClientMessage = { type: 'signon', user: str(m.user, 'user', 10), password: str(m.password, 'password', 128) };
      for (const key of SIGN_ON_EXTRAS) {
        if (m[key] === undefined || m[key] === '') continue;
        out[key] = str(m[key], key, 10);
      }
      return out;
    }
    case 'macro': {
      if (typeof m.macro !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(m.macro)) throw new Error('macro.macro must be a macro name');
      if (!(MACRO_OUTCOMES as readonly unknown[]).includes(m.outcome)) throw new Error(`macro.outcome must be one of ${MACRO_OUTCOMES.join(', ')}`);
      const out: ClientMessage = { type: 'macro', macro: m.macro, outcome: m.outcome as MacroOutcome };
      if (m.step !== undefined) {
        if (!Number.isInteger(m.step) || (m.step as number) < 1 || (m.step as number) > 100) throw new Error('macro.step must be a step number');
        out.step = m.step as number;
      }
      return out;
    }
    case 'submit': {
      if (!isAidName(m.aid)) throw new Error('submit.aid is not a valid AID key');
      const out: ClientMessage = { type: 'submit', aid: m.aid };
      if (m.fields !== undefined) {
        if (typeof m.fields !== 'object' || m.fields === null || Array.isArray(m.fields)) {
          throw new Error('submit.fields must be an object');
        }
        const entries = Object.entries(m.fields);
        if (entries.length > MAX_FIELDS) throw new Error('submit.fields has too many entries');
        const fields: Record<string, string> = {};
        for (const [id, value] of entries) {
          if (!/^\d{1,3}:\d{1,3}$/.test(id)) throw new Error(`submit.fields key "${id.slice(0, 20)}" is not a field id`);
          if (typeof value !== 'string' || value.length > MAX_FIELD_LENGTH) {
            throw new Error(`submit.fields["${id}"] must be a string`);
          }
          fields[id] = value;
        }
        out.fields = fields;
      }
      if (m.cursor !== undefined) {
        const c = m.cursor as Record<string, unknown> | null;
        const ok = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 132;
        if (typeof c !== 'object' || c === null || !ok(c.row) || !ok(c.col)) {
          throw new Error('submit.cursor must be {row, col} with 1-based integers');
        }
        out.cursor = { row: c.row as number, col: c.col as number };
      }
      return out;
    }
    default:
      throw new Error('Unknown message type');
  }
}
