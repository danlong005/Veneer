#!/usr/bin/env node
// Run before `npm start`: a clone, fork or source download has no compiled server or
// browser client until `npm run build`, and Node's own "Cannot find module" error
// doesn't say so.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const required = ['packages/server/dist/main.js', 'packages/client/dist/index.html'];
const missing = required.filter((f) => !fs.existsSync(fileURLToPath(new URL(`../${f}`, import.meta.url))));

if (missing.length > 0) {
  console.error(`Veneer has not been built (missing ${missing.join(', ')}).

This is the source (a git clone, fork or -src download). Build it first:

  npm ci
  npm run build
  npm start

On IBM i, the source can't be built. Install a release archive instead
(veneer-<version>.tar.gz or .zip from https://github.com/danlong005/Veneer/releases,
or one made with 'npm run package' on another machine).
See "From a clone, fork or source download" in deploy/README.md.`);
  process.exit(1);
}
