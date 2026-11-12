// veneer test (#51): macros with checks run against the host as tests, with
// values from tests/<macro>.json, reported as text, GitHub annotations, JSON
// and JUnit XML.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';
import { DefinitionError, validateMacro, type Macro } from '@veneer/screens';
import { checkFolder } from '../src/checkFolder.ts';
import { formatTests, junitReport, planTests, readTestFiles, runTests, validateTestFile, type CaseResult } from '../src/macroTests.ts';
import { DemoHost } from '../dev/demoHost.ts';

const DEMO_SCREENS = fileURLToPath(new URL('../dev/screens', import.meta.url));
const CLI = fileURLToPath(new URL('../src/testMacros.ts', import.meta.url));

let host: DemoHost;
let hostPort: number;
before(async () => {
  host = new DemoHost({ autoSignOn: true });
  hostPort = await host.listen();
});
after(() => host.server.close());

const END = {
  screen: '005ae4fb0b6762', title: 'Order Status',
  expect: [{ at: '7:22', equals: 'DLV', label: 'Status' }, { message: true, contains: 'not found', not: true }],
};

/** The demo's screens, with order-status checking for a delivered order, and tests for it. */
function screensDir(tests: object | null = { macro: 'order-delivered', cases: [{ name: 'delivered order', values: { order: '104572' } }, { name: 'unknown order', values: { order: 999999 } }] }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veneer-test-'));
  fs.cpSync(DEMO_SCREENS, dir, { recursive: true });
  const status = JSON.parse(fs.readFileSync(path.join(dir, 'macros/order-status.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'macros/order-delivered.json'), JSON.stringify({ ...status, name: 'order-delivered', label: 'Order is delivered', menu: false, end: END }));
  if (tests) {
    fs.mkdirSync(path.join(dir, 'tests'));
    fs.writeFileSync(path.join(dir, 'tests/order-delivered.json'), JSON.stringify(tests));
  }
  return dir;
}

const macro = (m: object): Macro => validateMacro({ name: 'm', label: 'M', steps: [{ screen: '1cb4b4c7237e07', press: 'Enter' }], ...m });

test('a tests file names a macro and its cases, each with a name and values', () => {
  assert.deepEqual(validateTestFile({ macro: 'order-status', cases: [{ name: ' one ', values: { order: '1' } }, { name: 'two' }] }),
    { macro: 'order-status', cases: [{ name: 'one', values: { order: '1' } }, { name: 'two' }] });
  const bad: Array<[unknown, RegExp]> = [
    [[], /JSON object/],
    [{ macro: 'Bad Name', cases: [{ name: 'a' }] }, /"macro" must be/],
    [{ macro: 'm', cases: [] }, /at least one case/],
    [{ macro: 'm', cases: [{ name: 'a' }, { name: 'a' }] }, /Case 2: another case is called “a”/],
    [{ macro: 'm', cases: [{ name: 'a', value: {} }] }, /Case 1: "value" is not a setting/],
    [{ macro: 'm', cases: [{ name: 'a', values: [] }] }, /Case 1: "values" must be an object/],
    [{ macro: 'm', cases: [{ name: 'a' }], fails: true }, /"fails" is not a setting/],
  ];
  for (const [input, message] of bad) assert.throws(() => validateTestFile(input), (e: Error) => e instanceof DefinitionError && message.test(e.message), JSON.stringify(input));
});

test('what runs: each case in a tests file, other macros with checks once, and those that need values are skipped', () => {
  const checked = macro({ name: 'checked', end: { expect: [{ at: '1:1', equals: 'x' }] } });
  const needs = macro({ name: 'needs', params: { order: { required: true } }, end: { expect: [{ at: '1:1', equals: 'x' }] } });
  const plain = macro({ name: 'plain' });
  const tested = macro({ name: 'tested', params: { order: { required: true, pattern: '\\d+' } } });
  const mainframe = macro({ name: 'mainframe', host: '3270', end: { expect: [{ at: '1:1', equals: 'x' }] } });
  const files = [
    { file: 'tests/tested.json', tests: { macro: 'tested', cases: [{ name: 'ok', values: { order: 12 } }, { name: 'letters', values: { order: 'abc' } }] } },
    { file: 'tests/gone.json', tests: { macro: 'gone', cases: [{ name: 'x' }] } },
    { file: 'tests/broken.json', error: 'It is not valid JSON' },
  ];
  const plan = planTests([checked, needs, plain, tested, mainframe], files, { hostType: '5250' });
  assert.deepEqual(plan.cases.map((c) => [c.macro.name, c.name, c.values ?? c.problem]), [
    ['tested', 'ok', { order: '12' }],
    ['tested', 'letters', { status: 'error', message: 'Its values: “abc” is not a valid order.' }],
    ['checked', 'M', {}],
    ['needs', 'M', { status: 'skipped', message: 'It needs values (order): give them in tests/needs.json.' }],
  ], 'plain has no checks and no tests; mainframe is for another host');
  assert.deepEqual(plan.problems, [
    { file: 'tests/gone.json', message: 'There is no macro "gone" (macros/gone.json).' },
    { file: 'tests/broken.json', message: 'It is not valid JSON' },
  ]);

  // --macro: only those, even one without checks; a name that doesn't exist is said.
  const only = planTests([checked, plain, tested], files, { only: ['plain', 'nope'] });
  assert.deepEqual(only.cases.map((c) => c.macro.name), ['plain']);
  assert.deepEqual(only.unknown, ['nope']);
  assert.deepEqual(only.problems, [{ file: 'tests/broken.json', message: 'It is not valid JSON' }]);
});

test('the cases run against the host: a pass, a failed check with the screen, and the report in every format', async () => {
  const dir = screensDir();
  const { ScreenStore } = await import('../src/store.ts');
  const store = new ScreenStore(dir);
  await store.load();
  const plan = planTests(store.listMacros(), await readTestFiles(dir), { only: ['order-delivered'] });
  const seen: string[] = [];
  const results = await runTests(plan.cases, {
    host: { host: '127.0.0.1', port: hostPort, tls: false },
    signOn: { user: 'TESTER', password: 'demo', substitute: 'sha' },
    definitions: () => store.list(),
    onResult: (r) => seen.push(r.name),
  });
  assert.deepEqual(seen, ['delivered order', 'unknown order']);
  const [pass, fail] = results as [CaseResult, CaseResult];
  assert.equal(pass.status, 'passed', pass.message);
  assert.equal(pass.checks?.length, 3);
  assert.equal(fail.status, 'failed');
  assert.match(fail.message!, /^At the end: Status equals “DLV”, but it is .+\. 1 other check failed too\.$/);
  assert.ok(fail.screen?.some((l) => l.includes('Order 999999 not found.')), 'the screen it stopped on');

  const report = { results, problems: [] };
  const text = formatTests(report, 'text');
  assert.match(text, /^✓ order-delivered › delivered order \(\d+\.\d{3}s, 3 checks\)$/m);
  assert.match(text, /^✗ order-delivered › unknown order /m);
  assert.match(text, /^ {4}✗ The message doesn't contain “not found”, but it is “Order 999999 not found\.”\.$/m);
  assert.match(text, /^2 tests: 1 passed, 1 failed\.$/m);
  assert.match(formatTests(report, 'github', dir), /^::error file=.+\/tests\/order-delivered\.json,title=Veneer test order-delivered › unknown order::At the end: /m);
  assert.equal(JSON.parse(formatTests(report, 'json')).failed, 1);

  const xml = junitReport(report, new Date('2026-11-12T00:00:00Z'));
  assert.match(xml, /<testsuites name="Veneer macros" tests="2" failures="1" errors="0" skipped="0" time="[\d.]+" timestamp="2026-11-12T00:00:00.000Z">/);
  assert.match(xml, /<testsuite name="order-delivered" tests="2" failures="1"/);
  assert.match(xml, /<testcase classname="veneer.order-delivered" name="delivered order" time="[\d.]+">\n {6}<system-out>✓ It ends on “Order Status”/);
  assert.match(xml, /<failure message="At the end: Status equals “DLV”, but it is [^"]+" type="check">Status equals “DLV”, but it is/);
  assert.match(xml, /The screen it stopped on:\n.*Order Status/s);
});

test('junit: skipped and errored runs, unusable files, and text XML can\'t hold', () => {
  const r = (x: Partial<CaseResult>): CaseResult => ({ macro: 'a&b', label: 'A', name: 'case', status: 'passed', ms: 1500, ...x });
  const xml = junitReport({
    results: [r({}), r({ name: 'needs', status: 'skipped', message: 'It needs values (order)' }), r({ name: '<x>', status: 'error', message: 'Signing on as "T" failed\u0007' })],
    problems: [{ file: 'tests/bad.json', message: 'It is not valid JSON' }],
  });
  assert.match(xml, /tests="4" failures="0" errors="2" skipped="1"/);
  assert.match(xml, /<testcase classname="veneer.a&amp;b" name="case" time="1.500"\/>/);
  assert.match(xml, /<skipped message="It needs values \(order\)"\/>/);
  assert.match(xml, /name="&lt;x&gt;"[^\n]*\n {6}<error message="Signing on as &quot;T&quot; failed" type="host"\/>/);
  assert.match(xml, /<testcase classname="veneer.files" name="tests\/bad.json" time="0">/);
});

test('a refused profile stops the run, so the remaining tests don\'t disable it', async () => {
  const m = macro({ name: 'checked', end: { expect: [{ at: '1:1', equals: 'x' }] } });
  let calls = 0;
  const results = await runTests([{ macro: m, name: 'one', values: {} }, { macro: m, name: 'two', values: {} }], {
    host: { host: '127.0.0.1', port: 1, tls: false }, signOn: { user: 'T', password: 'x', substitute: 'sha' }, definitions: () => [],
    run: async () => { calls++; return { outcome: 'signon', error: 'Signing on as T failed: wrong password.', refused: true }; },
  });
  assert.equal(calls, 1);
  assert.deepEqual(results.map((x) => [x.status, x.message]), [
    ['error', 'Signing on as T failed: wrong password.'],
    ['error', 'Not run: Signing on as T failed: wrong password.'],
  ]);
});

test('veneer check reports tests files for macros that don\'t exist and values a macro won\'t take', async () => {
  const dir = screensDir({ macro: 'order-delivered', cases: [{ name: 'no order' }, { name: 'extra', values: { order: '1', colour: 'red' } }] });
  fs.writeFileSync(path.join(dir, 'tests/gone.json'), JSON.stringify({ macro: 'gone', cases: [{ name: 'x' }] }));
  fs.writeFileSync(path.join(dir, 'tests/misnamed.json'), JSON.stringify({ macro: 'order-status', cases: [{ name: 'x' }] }));
  const found = (await checkFolder(dir)).findings.filter((f) => f.file.startsWith('tests/'));
  assert.deepEqual(found.map((f) => [f.file, f.message]), [
    ['tests/gone.json', 'There is no macro "gone" (macros/gone.json).'],
    ['tests/misnamed.json', 'It tests "order-status", so the file must be called order-status.json.'],
    ['tests/order-delivered.json', 'Case “no order”: Order is delivered needs order number.'],
    ['tests/order-delivered.json', 'Case “extra”: “colour” is not one of the macro\'s values (order).'],
  ]);
});

test('the command: settings from the environment, exit 1 on a failure, a JUnit file, and exit 2 for wrong settings', async () => {
  const dir = screensDir();
  const junit = path.join(dir, 'out/report.xml');
  const env = {
    PATH: process.env.PATH, VENEER_HOST: '127.0.0.1', VENEER_PORT: String(hostPort), VENEER_TLS: 'false', VENEER_QPWDLVL: '2',
    VENEER_TEST_USER: 'tester', VENEER_TEST_PASSWORD: 'demo', VENEER_LOG_LEVEL: 'error', GITHUB_ACTIONS: '',
  };
  const cli = (args: string[], extra: Record<string, string> = {}) => promisify(execFile)(process.execPath, ['--conditions=veneer-source', CLI, ...args], { env: { ...env, ...extra } })
    .then((r) => ({ code: 0, ...r }), (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));

  const run = await cli([dir, '--junit', junit]);
  assert.equal(run.code, 1, run.stderr);
  assert.match(run.stdout, /^✓ order-delivered › delivered order/m);
  assert.match(run.stdout, /^2 tests: 1 passed, 1 failed\.$/m);
  assert.match(fs.readFileSync(junit, 'utf8'), /<testsuites name="Veneer macros" tests="2" failures="1"/);

  // One case passing: exit 0. Order Status with no checks, run by name.
  fs.writeFileSync(path.join(dir, 'tests/order-delivered.json'), JSON.stringify({ macro: 'order-delivered', cases: [{ name: 'delivered order', values: { order: '104572' } }] }));
  const ok = await cli([dir, '--macro', 'order-delivered', '--format', 'json']);
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  assert.equal(JSON.parse(ok.stdout).passed, 1);

  const noUser = await cli([dir], { VENEER_TEST_USER: '' });
  assert.equal(noUser.code, 2);
  assert.match(noUser.stderr, /Set VENEER_TEST_USER/);
  const noLevel = await cli([dir], { VENEER_QPWDLVL: '' });
  assert.equal(noLevel.code, 2);
  assert.match(noLevel.stderr, /^veneer test signs on automatically, so it needs VENEER_QPWDLVL/);
  const unknown = await cli([dir, '--macro', 'nope']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /There is no macro "nope"/);
});
