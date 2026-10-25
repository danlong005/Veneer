// Custom components: developer-written ES modules in a directory on the
// server (VENEER_COMPONENTS_DIR), served at /components/ and listed at
// /api/components for the client and the designer. They are installed by
// whoever runs the server; nothing in the designer can write them.

import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { ID_PATTERN } from '@veneer/screens';
import { sendFile } from './static.ts';

export interface ComponentInfo {
  /** The file name without ".js": what a `component` change names. */
  name: string;
  /** Changes when the file does, so browsers load the new one. */
  version: string;
}

/** The components in a directory: its top-level .js files with valid names. */
export function listComponents(dir: string | undefined): ComponentInfo[] {
  if (!dir) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.js') && ID_PATTERN.test(e.name.slice(0, -3)))
    .map((e) => {
      const stat = fs.statSync(path.join(dir, e.name));
      return { name: e.name.slice(0, -3), version: `${Math.trunc(stat.mtimeMs).toString(36)}-${stat.size.toString(36)}` };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Serve a file under /components/: a component, or a file it imports from the
 * same directory. Hidden files (and folders) are not served.
 */
export function serveComponent(dir: string | undefined, req: http.IncomingMessage, res: http.ServerResponse, pathname: string): void {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname.slice('/components/'.length));
  } catch {
    return void res.writeHead(400).end();
  }
  if (!dir || rel.split(/[\\/]/).some((part) => part.startsWith('.') || part === '')) return void res.writeHead(404).end();
  // Components are versioned in their URL (?v=), so browsers check back each time.
  if (!sendFile(dir, rel, req, res, 'no-cache')) res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
}
