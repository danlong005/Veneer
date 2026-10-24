// The server's version, from its package.json (works from src/ and dist/).

import fs from 'node:fs';

export const VERSION: string = (() => {
  try {
    return (JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
})();
