// Minimal structured logger: one JSON object per line. Never log field values:
// they include passwords.
//
// Writes to stdout/stderr by default (systemd's journal collects these). With
// a file set it writes there instead, rotating by size, because IBM i has no
// logrotate: veneer.log -> veneer.log.1 -> ... -> veneer.log.<keep>.

import fs from 'node:fs';
import path from 'node:path';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogOptions {
  level?: string | undefined;
  /** Log file path; unset logs to stdout/stderr. */
  file?: string | undefined;
  /** Rotate when the file reaches this size. */
  maxBytes?: number;
  /** Rotated files to keep. */
  keep?: number;
}

let threshold = ORDER.info;
let file: { path: string; maxBytes: number; keep: number; size: number } | null = null;

/** Apply logging settings. Throws if the log directory cannot be created. */
export function configureLog(opts: LogOptions): void {
  threshold = ORDER[opts.level as Level] ?? ORDER.info;
  if (!opts.file) {
    file = null;
    return;
  }
  fs.mkdirSync(path.dirname(opts.file), { recursive: true });
  let size = 0;
  try { size = fs.statSync(opts.file).size; } catch { /* new file */ }
  file = { path: opts.file, maxBytes: opts.maxBytes ?? 10 * 1024 * 1024, keep: opts.keep ?? 5, size };
}

configureLog({ level: process.env.VENEER_LOG_LEVEL });

function rotate(f: NonNullable<typeof file>): void {
  for (let i = f.keep - 1; i >= 1; i--) {
    try { fs.renameSync(`${f.path}.${i}`, `${f.path}.${i + 1}`); } catch { /* gap */ }
  }
  try { fs.renameSync(f.path, `${f.path}.1`); } catch { /* already gone */ }
  if (f.keep < 1) fs.rmSync(`${f.path}.1`, { force: true });
  f.size = 0;
}

function write(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < threshold) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields }) + '\n';
  if (!file) {
    (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line);
    return;
  }
  try {
    if (file.size + line.length > file.maxBytes && file.size > 0) rotate(file);
    fs.appendFileSync(file.path, line);
    file.size += Buffer.byteLength(line);
  } catch (err) {
    // Never let logging take the server down; fall back to stderr.
    process.stderr.write(`log file error: ${(err as Error).message}\n${line}`);
  }
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => write('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields),
};
