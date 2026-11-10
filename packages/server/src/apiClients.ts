// The systems allowed to run macros through the macro API (macroApi.ts), from
// the JSON file VENEER_API_CLIENTS names. Each client has its own token and
// signs on to the IBM i as its own service profile, whose password is in an
// environment variable, never in the file or the request:
//
//   {
//     "erp": {
//       "token": "sha256:<the token's SHA-256, from npm run api:token>",
//       "user": "VENEERAPI",
//       "passwordEnv": "VENEER_API_ERP_PASSWORD",
//       "macros": ["order-status"],
//       "maxRuns": 2
//     }
//   }

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { ID_PATTERN } from '@veneer/screens';
import { USER_PROFILE, passwordProblem, type PasswordSubstitute } from './host.ts';

export interface ApiClient {
  /** What the log and the admin page call it. */
  name: string;
  /** SHA-256 of its token. */
  tokenHash: Buffer;
  /** The IBM i user profile its runs sign on as. */
  user: string;
  password: string;
  /** The macros it may run; undefined: every macro marked for the API. */
  macros?: string[];
  /** Runs at once; more are refused with 429. */
  maxRuns: number;
}

export const DEFAULT_MAX_RUNS = 2;
const MAX_RUNS_LIMIT = 20;
const CLIENT_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;
const TOKEN_HASH = /^sha256:([0-9a-f]{64})$/;

/** Read and check the clients file. Throws with a message naming the file and the client. */
export function loadApiClients(file: string, env: NodeJS.ProcessEnv, substitute: PasswordSubstitute): ApiClient[] {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`VENEER_API_CLIENTS: can't read ${file}: ${(err as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`VENEER_API_CLIENTS: ${file} is not valid JSON: ${(err as Error).message}`);
  }
  return parseApiClients(json, env, substitute, file);
}

export function parseApiClients(json: unknown, env: NodeJS.ProcessEnv, substitute: PasswordSubstitute, file = 'the API clients file'): ApiClient[] {
  const fail = (message: string): never => { throw new Error(`VENEER_API_CLIENTS (${file}): ${message}`); };
  if (json === null || typeof json !== 'object' || Array.isArray(json)) fail('must be an object of clients by name');
  const clients: ApiClient[] = [];
  const hashes = new Set<string>();
  for (const [name, raw] of Object.entries(json as Record<string, unknown>)) {
    const at = (msg: string) => fail(`client "${name.slice(0, 32)}": ${msg}`);
    if (!CLIENT_NAME.test(name)) at('names are lowercase letters, digits and dashes');
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) at('must be an object');
    const c = raw as Record<string, unknown>;
    for (const key of Object.keys(c)) {
      if (!['token', 'user', 'passwordEnv', 'macros', 'maxRuns'].includes(key)) {
        at(key === 'password' ? 'put the password in an environment variable and name it in passwordEnv' : `"${key.slice(0, 32)}" is not a setting`);
      }
    }
    const token = typeof c.token === 'string' ? TOKEN_HASH.exec(c.token) : null;
    if (!token) at('token must be "sha256:" and the token\'s SHA-256 in hex (npm run api:token makes one)');
    if (hashes.has(token![1]!)) at('has the same token as another client');
    hashes.add(token![1]!);
    const user = typeof c.user === 'string' ? c.user.trim().toUpperCase() : '';
    if (!USER_PROFILE.test(user)) at('user must be an IBM i user profile');
    if (typeof c.passwordEnv !== 'string' || !ENV_NAME.test(c.passwordEnv)) at('passwordEnv must name an environment variable, such as VENEER_API_ERP_PASSWORD');
    const password = env[c.passwordEnv as string] ?? '';
    if (password === '') at(`the environment variable ${c.passwordEnv as string} (its password) is not set`);
    const problem = passwordProblem(password, substitute);
    if (problem) at(`the password in ${c.passwordEnv as string}: ${problem}`);
    let macros: string[] | undefined;
    if (c.macros !== undefined) {
      if (!Array.isArray(c.macros) || c.macros.length === 0 || !c.macros.every((m) => typeof m === 'string' && ID_PATTERN.test(m))) {
        at('macros must be a list of macro names (or left out for every macro marked for the API)');
      }
      macros = [...new Set(c.macros as string[])];
    }
    let maxRuns = DEFAULT_MAX_RUNS;
    if (c.maxRuns !== undefined) {
      if (!Number.isInteger(c.maxRuns) || (c.maxRuns as number) < 1 || (c.maxRuns as number) > MAX_RUNS_LIMIT) at(`maxRuns must be a whole number from 1 to ${MAX_RUNS_LIMIT}`);
      maxRuns = c.maxRuns as number;
    }
    clients.push({ name, tokenHash: Buffer.from(token![1]!, 'hex'), user, password, ...(macros ? { macros } : {}), maxRuns });
  }
  if (clients.length === 0) fail('lists no clients');
  return clients;
}

/** The client a request's bearer token belongs to. */
export function clientFor(clients: readonly ApiClient[], authorization: string | undefined): ApiClient | undefined {
  const given = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (given === '') return undefined;
  const hash = createHash('sha256').update(given).digest();
  // Every client compared, in constant time, so timing says nothing about which tokens exist.
  let found: ApiClient | undefined;
  for (const c of clients) if (timingSafeEqual(hash, c.tokenHash) && !found) found = c;
  return found;
}

/** A new token and the line for the clients file. */
export function newToken(): { token: string; hash: string } {
  const token = `vnr_${randomBytes(24).toString('base64url')}`;
  return { token, hash: `sha256:${createHash('sha256').update(token).digest('hex')}` };
}
