// veneer test: runs the macros that check what screens show (expect, end)
// against the IBM i, signed on as a test profile, and reports each run, for
// CI. See macroTests.ts for what runs and with which values.
//
//   node packages/server/dist/testMacros.js [screens folder] [--config veneer.env]
//        [--macro name]... [--junit report.xml] [--format text|github|json]
//   npm run test:macros -- [screens folder] ...                 (from the repository)
//
// The host settings are the server's (VENEER_HOST, VENEER_PORT, VENEER_TLS,
// VENEER_QPWDLVL, VENEER_DEVNAME_PREFIX ...), from the environment or the
// --config file. The profile is VENEER_TEST_USER, its password
// VENEER_TEST_PASSWORD. Exit codes: 0 every test passed (or was skipped),
// 1 a test failed or couldn't run, 2 the command or its settings are wrong.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DeviceNamePool } from './devices.ts';
import { USER_PROFILE, apiSubstitute, deviceNameLength, hostSettingsFromEnv, hostTypeOf, passwordProblem, type AutoSignOn, type HostSettings } from './host.ts';
import { configureLog } from './log.ts';
import { failed, formatTests, junitReport, planTests, readTestFiles, resultLines, runTests, summary, type TestFormat } from './macroTests.ts';
import { ScreenStore } from './store.ts';

const USAGE = 'Usage: veneer test [screens folder] [--config veneer.env] [--macro name]... [--junit report.xml] [--format text|github|json]';

const usage = (message?: string): never => {
  console.error(message ? `${message}\n${USAGE}` : USAGE);
  process.exit(2);
};

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      macro: { type: 'string', multiple: true },
      junit: { type: 'string' },
      format: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (err) {
  usage((err as Error).message);
}
if (args!.values.help) {
  console.log(USAGE);
  process.exit(0);
}
const { values, positionals } = args!;
const format = (values.format ?? (process.env.GITHUB_ACTIONS === 'true' ? 'github' : 'text')) as TestFormat;
if (!['text', 'github', 'json'].includes(format) || positionals.length > 1) usage();

const configFile = values.config ?? process.env.VENEER_CONFIG;
if (configFile) {
  if (!fs.existsSync(configFile)) usage(`The config file ${configFile} doesn't exist.`);
  // Values already in the environment win, as with node --env-file.
  process.loadEnvFile(configFile);
}
// Warnings (a screen definition that can't be read) on stderr; not every session detail.
configureLog({ level: process.env.VENEER_LOG_LEVEL || 'warn' });

const dir = path.resolve(positionals[0] ?? process.env.VENEER_SCREENS_DIR ?? 'screens');
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) usage(`${dir} is not a folder.`);

let host: HostSettings, signOn: AutoSignOn, devices: DeviceNamePool | undefined;
try {
  // The server's settings refuse VENEER_QPWDLVL unless the server signs on itself; this always does.
  host = hostSettingsFromEnv((process.env.VENEER_SIGNON ?? '').trim() === 'auto' ? process.env : { ...process.env, VENEER_QPWDLVL: '' });
  if (hostTypeOf(host) !== '5250') throw new Error('veneer test signs on to an IBM i automatically, so it is for 5250 hosts (VENEER_HOST_TYPE=5250).');
  const substitute = apiSubstitute(process.env, '5250');
  const user = (process.env.VENEER_TEST_USER ?? '').trim().toUpperCase();
  if (!USER_PROFILE.test(user)) throw new Error('Set VENEER_TEST_USER to the IBM i user profile the tests sign on as.');
  const password = process.env.VENEER_TEST_PASSWORD ?? '';
  if (password === '') throw new Error('Set VENEER_TEST_PASSWORD to the password of VENEER_TEST_USER.');
  const problem = passwordProblem(password, substitute);
  if (problem) throw new Error(`VENEER_TEST_PASSWORD: ${problem}`);
  signOn = { user, password, substitute };
  if (process.env.VENEER_DEVNAME_PREFIX) devices = new DeviceNamePool(process.env.VENEER_DEVNAME_PREFIX, deviceNameLength('5250'));
} catch (err) {
  usage((err as Error).message.replace(/The macro API \(VENEER_API_CLIENTS\)/, 'veneer test'));
}

const store = new ScreenStore(dir);
await store.load();
const plan = planTests(store.listMacros(), await readTestFiles(dir), { ...(values.macro ? { only: values.macro } : {}), hostType: '5250' });
if (plan.unknown.length) usage(`There is no macro ${plan.unknown.map((n) => `"${n}"`).join(', ')} in ${path.join(dir, 'macros')}.`);

// A person watching sees each test as it finishes; the other formats come at the end.
const live = format === 'text';
if (live) for (const p of plan.problems) console.log(`! ${p.file}\n    ${p.message}`);
const results = await runTests(plan.cases, {
  host: host!, signOn: signOn!, ...(devices ? { devices } : {}),
  definitions: () => store.list(),
  ...(live ? { onResult: (r) => console.log(resultLines(r).join('\n')) } : {}),
});
const report = { results, problems: plan.problems };
console.log(live ? summary(report) : formatTests(report, format, dir));
if (values.junit) {
  fs.mkdirSync(path.dirname(path.resolve(values.junit)), { recursive: true });
  fs.writeFileSync(values.junit, junitReport(report));
}
process.exit(failed(report) ? 1 : 0);
