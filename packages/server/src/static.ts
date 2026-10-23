// Serves the built browser client. Unknown paths fall back to index.html.

import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

export function serveStatic(root: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  const base = path.resolve(root);
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  let file = path.resolve(base, '.' + pathname);
  if (file !== base && !file.startsWith(base + path.sep)) return send(res, 404, 'Not found');
  if (!isFile(file)) file = path.join(base, 'index.html');
  if (!isFile(file)) return send(res, 404, 'Client not built');

  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
  });
  if (req.method === 'HEAD') return void res.end();
  fs.createReadStream(file).pipe(res);
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function send(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}
