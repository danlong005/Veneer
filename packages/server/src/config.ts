// Server settings from VENEER_* environment variables (see .env.example).

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hostSettingsFromEnv, type HostSettings } from '@veneer/tn5250';
import { DeviceNamePool } from './devices.ts';

export interface ServerConfig {
  listenHost: string;
  listenPort: number;
  /** Serve HTTPS/WSS when set. */
  https?: { cert: Buffer; key: Buffer };
  /** The one IBM i every browser session connects to. */
  host: HostSettings;
  idleTimeoutMs: number;
  /** How long a host session survives with no browser attached (page reloads). */
  resumeGraceMs: number;
  maxSessions: number;
  /** Name devices PREFIX01, PREFIX02, ...; unset lets IBM i assign QPADEVxxxx. */
  deviceNamePrefix?: string;
  /** Allowed browser origins; empty means same-origin only. */
  allowedOrigins: string[];
  /** Directory of client files to serve, if any. */
  staticDir?: string;
  /** Directory of screen definition JSON files. */
  screensDir: string;
  /** Bearer token for saving definitions from the designer; unset disables it. */
  designerToken?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const host = hostSettingsFromEnv(env);
  // A fixed device name can only be used by one session at a time; see VENEER_DEVNAME_PREFIX.
  delete host.deviceName;

  // Validate the device name prefix now rather than on the first connection.
  if (env.VENEER_DEVNAME_PREFIX) new DeviceNamePool(env.VENEER_DEVNAME_PREFIX);

  if (env.VENEER_DESIGNER_TOKEN !== undefined && env.VENEER_DESIGNER_TOKEN !== '' && env.VENEER_DESIGNER_TOKEN.length < 12) {
    throw new Error('VENEER_DESIGNER_TOKEN must be at least 12 characters');
  }

  const cert = env.VENEER_HTTPS_CERT, key = env.VENEER_HTTPS_KEY;
  if (Boolean(cert) !== Boolean(key)) throw new Error('Set both VENEER_HTTPS_CERT and VENEER_HTTPS_KEY, or neither');

  return {
    listenHost: env.VENEER_LISTEN_HOST || '127.0.0.1',
    listenPort: int(env, 'VENEER_LISTEN_PORT', 8080),
    ...(cert && key ? { https: { cert: fs.readFileSync(cert), key: fs.readFileSync(key) } } : {}),
    host,
    idleTimeoutMs: int(env, 'VENEER_IDLE_TIMEOUT_MINUTES', 30) * 60_000,
    resumeGraceMs: int(env, 'VENEER_RESUME_GRACE_SECONDS', 60) * 1000,
    maxSessions: int(env, 'VENEER_MAX_SESSIONS', 100),
    ...(env.VENEER_DEVNAME_PREFIX ? { deviceNamePrefix: env.VENEER_DEVNAME_PREFIX } : {}),
    allowedOrigins: (env.VENEER_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    ...(staticDir(env) ? { staticDir: staticDir(env)! } : {}),
    screensDir: env.VENEER_SCREENS_DIR || fileURLToPath(new URL('../../../screens', import.meta.url)),
    ...(env.VENEER_DESIGNER_TOKEN ? { designerToken: env.VENEER_DESIGNER_TOKEN } : {}),
  };
}

/** VENEER_STATIC_DIR, else the built client next to this package (packages/client/dist). */
function staticDir(env: NodeJS.ProcessEnv): string | undefined {
  if (env.VENEER_STATIC_DIR) return env.VENEER_STATIC_DIR;
  const bundled = fileURLToPath(new URL('../../client/dist', import.meta.url));
  return fs.existsSync(bundled) ? bundled : undefined;
}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  return n;
}
