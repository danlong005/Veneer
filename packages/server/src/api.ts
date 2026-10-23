// /api: screen definitions for the client, and editing for the designer.

import { createHash, timingSafeEqual } from 'node:crypto';
import type http from 'node:http';
import { DefinitionError, ID_PATTERN } from '@veneer/screens';
import { log } from './log.ts';
import type { ScreenStore } from './store.ts';

const MAX_BODY = 256 * 1024;

export interface ApiOptions {
  store: ScreenStore;
  /** Bearer token required to change definitions; unset disables the designer. */
  designerToken?: string | undefined;
}

/** Handle an /api request. Returns false if the path is not an API route. */
export function handleApi(req: http.IncomingMessage, res: http.ServerResponse, pathname: string, opts: ApiOptions): boolean {
  if (!pathname.startsWith('/api/')) return false;
  void route(req, res, pathname, opts).catch((err: Error) => {
    log.error('api error', { path: pathname, error: err.message });
    if (!res.headersSent) json(res, 500, { error: 'Internal error' });
  });
  return true;
}

async function route(req: http.IncomingMessage, res: http.ServerResponse, pathname: string, opts: ApiOptions): Promise<void> {
  const { store } = opts;
  res.setHeader('Cache-Control', 'no-store');

  if (pathname === '/api/config' && req.method === 'GET') {
    return json(res, 200, { designer: Boolean(opts.designerToken) });
  }
  if (pathname === '/api/screens' && req.method === 'GET') {
    return json(res, 200, { version: store.version, screens: store.list() });
  }

  const m = /^\/api\/screens\/([^/]+)$/.exec(pathname);
  if (!m) return json(res, 404, { error: 'Not found' });
  const id = decodeURIComponent(m[1]!);
  if (!ID_PATTERN.test(id)) return json(res, 400, { error: 'Invalid screen id' });
  if (req.method !== 'PUT' && req.method !== 'DELETE') return json(res, 405, { error: 'Method not allowed' });

  if (!opts.designerToken) return json(res, 403, { error: 'The designer is disabled (set VENEER_DESIGNER_TOKEN)' });
  if (!authorized(req, opts.designerToken)) return json(res, 401, { error: 'Designer token required' });

  if (req.method === 'DELETE') {
    const removed = await store.remove(id);
    if (removed) log.info('screen definition deleted', { id });
    return removed ? void res.writeHead(204).end() : json(res, 404, { error: 'No such screen' });
  }

  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return json(res, 400, { error: (err as Error).message.startsWith('Body') ? (err as Error).message : 'Body is not valid JSON' });
  }
  if ((body as { id?: unknown } | null)?.id !== id) return json(res, 400, { error: 'id in the body must match the URL' });
  try {
    const saved = await store.save(body);
    log.info('screen definition saved', { id, changes: saved.changes.length });
    return json(res, 200, saved);
  } catch (err) {
    if (err instanceof DefinitionError) return json(res, 400, { error: err.message });
    throw err;
  }
}

function authorized(req: http.IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Hash both sides so the comparison is constant-time regardless of length.
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(token).digest();
  return given !== '' && timingSafeEqual(a, b);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error(`Body larger than ${MAX_BODY} bytes`));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
