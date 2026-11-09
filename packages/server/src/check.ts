// veneer check: validates a screens folder for CI. Definitions and macros are
// checked against each other and against the screens recorded in snapshots/.
//
//   node packages/server/dist/check.js [screens folder] [--strict] [--format text|github|json]
//   npm run check:screens -- [screens folder]                     (from the repository)
//
// The folder is VENEER_SCREENS_DIR, else ./screens. Exit codes: 0 no errors
// (warnings too with --strict), 1 problems found, 2 the command was wrong.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { checkFolder, formatReport, type ReportFormat } from './checkFolder.ts';

const USAGE = 'Usage: veneer check [screens folder] [--strict] [--format text|github|json]';

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: { strict: { type: 'boolean' }, format: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  });
} catch (err) {
  console.error(`${(err as Error).message}\n${USAGE}`);
  process.exit(2);
}
if (args.values.help) {
  console.log(USAGE);
  process.exit(0);
}
const format = (args.values.format ?? (process.env.GITHUB_ACTIONS === 'true' ? 'github' : 'text')) as ReportFormat;
if (!['text', 'github', 'json'].includes(format) || args.positionals.length > 1) {
  console.error(USAGE);
  process.exit(2);
}
const dir = path.resolve(args.positionals[0] ?? process.env.VENEER_SCREENS_DIR ?? 'screens');
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error(`${dir} is not a folder. ${USAGE}`);
  process.exit(2);
}

const result = await checkFolder(dir);
console.log(formatReport(result, dir, format));
const failed = result.findings.some((f) => f.level === 'error' || args.values.strict);
process.exit(failed ? 1 : 0);
