// Macros as tests (`veneer test`, testMacros.ts): each macro with checks runs
// against the host, signed on as a test profile, through the same run the
// macro API uses (apiRun.ts), and the results are reported for a person, for
// GitHub Actions, as JSON, or as a JUnit XML file for any CI server.
//
// The values a macro runs with are in tests/<macro>.json in the screens
// folder, one case per run:
//
//   { "macro": "order-delivered",
//     "cases": [{ "name": "delivered order", "values": { "order": "104572" } }] }
//
// A macro with checks and no tests file runs once with no values, unless it
// needs some: then it is skipped, saying which.

import fs from 'node:fs/promises';
import path from 'node:path';
import { DefinitionError, ID_PATTERN, apiValues, failureText, type CheckResult, type Macro, type ScreenDefinition } from '@veneer/screens';
import type { AutoSignOn, HostSettings } from './host.ts';
import { DeviceNamePool } from './devices.ts';
import { runMacro, type RunResult } from './apiRun.ts';
import type { HostLease } from './sessions.ts';

export const TESTS_DIR = 'tests';
export const MAX_CASES = 100;
const MAX_CASE_NAME = 100;

export interface MacroTestFile {
  macro: string;
  cases: MacroTestCase[];
}

export interface MacroTestCase {
  /** What the report calls it: "delivered order". */
  name: string;
  values?: Record<string, string | number>;
}

/** Checks a tests file's shape; its values are checked against the macro by testValues. Throws DefinitionError. */
export function validateTestFile(input: unknown): MacroTestFile {
  const fail = (msg: string): never => { throw new DefinitionError(msg); };
  if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('A tests file must be a JSON object with "macro" and "cases".');
  const o = input as Record<string, unknown>;
  for (const key of Object.keys(o)) if (key !== 'macro' && key !== 'cases') fail(`"${key.slice(0, 32)}" is not a setting of a tests file (macro, cases).`);
  if (typeof o.macro !== 'string' || !ID_PATTERN.test(o.macro)) fail('"macro" must be the name of a macro.');
  if (!Array.isArray(o.cases) || o.cases.length === 0) fail('"cases" must be a list of at least one case.');
  const cases = o.cases as unknown[];
  if (cases.length > MAX_CASES) fail(`A tests file has at most ${MAX_CASES} cases.`);
  const names = new Set<string>();
  const out = cases.map((c, i): MacroTestCase => {
    const at = (msg: string) => fail(`Case ${i + 1}: ${msg}`);
    if (c === null || typeof c !== 'object' || Array.isArray(c)) return at('it must be an object with a "name".');
    const k = c as Record<string, unknown>;
    for (const key of Object.keys(k)) if (key !== 'name' && key !== 'values') at(`"${key.slice(0, 32)}" is not a setting of a case (name, values).`);
    const name = typeof k.name === 'string' ? k.name.trim() : '';
    if (name === '' || name.length > MAX_CASE_NAME) at(`"name" must be 1 to ${MAX_CASE_NAME} characters.`);
    if (names.has(name)) at(`another case is called “${name}”.`);
    names.add(name);
    if (k.values === undefined) return { name };
    if (k.values === null || typeof k.values !== 'object' || Array.isArray(k.values)) at('"values" must be an object of the macro\'s values.');
    return { name, values: k.values as Record<string, string | number> };
  });
  return { macro: o.macro as string, cases: out };
}

/** A case's values, checked against its macro as the macro API checks a caller's. Throws DefinitionError. */
export function testValues(macro: Macro, c: MacroTestCase): Record<string, string> {
  return apiValues(macro, c.values ?? {});
}

/** The macro checks what screens show. */
export function hasChecks(m: Macro): boolean {
  return Boolean(m.end) || m.steps.some((s) => s.expect?.length);
}

/** The tests files in a screens folder, each read and checked, or why it can't be used. */
export async function readTestFiles(dir: string): Promise<Array<{ file: string; tests?: MacroTestFile; error?: string }>> {
  let names: string[];
  try {
    names = (await fs.readdir(path.join(dir, TESTS_DIR), { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: Array<{ file: string; tests?: MacroTestFile; error?: string }> = [];
  for (const name of names) {
    const file = `${TESTS_DIR}/${name}`;
    try {
      const text = await fs.readFile(path.join(dir, file), 'utf8');
      let json: unknown;
      try { json = JSON.parse(text); } catch (err) { throw new Error(`It is not valid JSON: ${(err as Error).message}`); }
      const tests = validateTestFile(json);
      if (name !== `${tests.macro}.json`) throw new Error(`It tests "${tests.macro}", so the file must be called ${tests.macro}.json.`);
      out.push({ file, tests });
    } catch (err) {
      out.push({ file, error: (err as Error).message });
    }
  }
  return out;
}

/** One run to make, or why it isn't made. */
export interface PlannedCase {
  macro: Macro;
  name: string;
  /** From this tests file; undefined for a macro run once with no values. */
  file?: string;
  values?: Record<string, string>;
  /** It can't run: the reason, and whether that is a mistake (error) or just nothing to run with (skipped). */
  problem?: { status: 'error' | 'skipped'; message: string };
}

/**
 * What to run: every case in the tests files, and each other macro with
 * checks once. `only` limits it to macros by name (each then runs even
 * without checks). Macros for another kind of host are left out.
 */
export function planTests(
  macros: readonly Macro[], files: ReadonlyArray<{ file: string; tests?: MacroTestFile; error?: string }>,
  opts: { only?: readonly string[]; hostType?: string } = {},
): { cases: PlannedCase[]; problems: Array<{ file: string; message: string }>; unknown: string[] } {
  const byName = new Map(macros.map((m) => [m.name, m]));
  const only = opts.only?.length ? new Set(opts.only) : undefined;
  const wanted = (m: Macro) => (!only || only.has(m.name)) && (!m.host || !opts.hostType || m.host === opts.hostType);
  const problems: Array<{ file: string; message: string }> = [];
  const cases: PlannedCase[] = [];
  const tested = new Set<string>();
  for (const f of files) {
    if (!f.tests) {
      // A broken file whose macro can't be told: reported whatever is being run.
      problems.push({ file: f.file, message: f.error ?? 'It can\'t be read.' });
      continue;
    }
    const macro = byName.get(f.tests.macro);
    if (!macro) {
      if (!only || only.has(f.tests.macro)) problems.push({ file: f.file, message: `There is no macro "${f.tests.macro}" (macros/${f.tests.macro}.json).` });
      continue;
    }
    tested.add(macro.name);
    if (!wanted(macro)) continue;
    for (const c of f.tests.cases) {
      try {
        cases.push({ macro, name: c.name, file: f.file, values: testValues(macro, c) });
      } catch (err) {
        if (!(err instanceof DefinitionError)) throw err;
        cases.push({ macro, name: c.name, file: f.file, problem: { status: 'error', message: `Its values: ${err.message}` } });
      }
    }
  }
  for (const macro of [...macros].sort((a, b) => a.name.localeCompare(b.name))) {
    if (tested.has(macro.name) || !wanted(macro) || (!only && !hasChecks(macro))) continue;
    const needs = Object.entries(macro.params ?? {}).filter(([, p]) => p.required).map(([k]) => k);
    cases.push({
      macro, name: macro.label,
      ...(needs.length
        ? { problem: { status: 'skipped' as const, message: `It needs values (${needs.join(', ')}): give them in ${TESTS_DIR}/${macro.name}.json.` } }
        : { values: testValues(macro, { name: macro.label }) }),
    });
  }
  const unknown = only ? [...only].filter((n) => !byName.has(n)) : [];
  return { cases, problems, unknown };
}

export type CaseStatus = 'passed' | 'failed' | 'error' | 'skipped';

export interface CaseResult {
  macro: string;
  label: string;
  name: string;
  file?: string;
  status: CaseStatus;
  /** Why it failed, errored or was skipped. */
  message?: string;
  step?: number;
  checks?: CheckResult[];
  /** The screen it stopped on, row by row, when it failed. */
  screen?: string[];
  ms: number;
}

export interface TestSetup {
  host: HostSettings;
  signOn: AutoSignOn;
  /** VENEER_DEVNAME_PREFIX: named devices for the runs. */
  devices?: DeviceNamePool;
  definitions: () => readonly ScreenDefinition[];
  /** Each result as it is made, for progress. */
  onResult?: (r: CaseResult) => void;
  /** Stand-in for runMacro, for tests. */
  run?: typeof runMacro;
}

/** Runs the cases one at a time. After the profile is refused, the rest aren't run, so it isn't disabled. */
export async function runTests(cases: readonly PlannedCase[], setup: TestSetup): Promise<CaseResult[]> {
  const run = setup.run ?? runMacro;
  const results: CaseResult[] = [];
  let refused: string | undefined;
  for (const c of cases) {
    const base = { macro: c.macro.name, label: c.macro.label, name: c.name, ...(c.file ? { file: c.file } : {}) };
    let r: CaseResult;
    if (c.problem) r = { ...base, status: c.problem.status, message: c.problem.message, ms: 0 };
    else if (refused) r = { ...base, status: 'error', message: `Not run: ${refused}`, ms: 0 };
    else {
      const started = Date.now();
      const out = await run({ host: setup.host, lease: leaseFrom(setup.devices), signOn: setup.signOn, macro: c.macro, values: c.values!, definitions: setup.definitions });
      if (out.outcome === 'signon' && out.refused) refused = out.error;
      r = { ...base, ...resultOf(out), ms: Date.now() - started };
    }
    results.push(r);
    setup.onResult?.(r);
  }
  return results;
}

function resultOf(out: RunResult): Pick<CaseResult, 'status' | 'message' | 'step' | 'checks' | 'screen'> {
  const checks = 'checks' in out && out.checks ? { checks: out.checks } : {};
  switch (out.outcome) {
    case 'done': return { status: 'passed', ...checks };
    case 'stopped':
    case 'timeout':
      return { status: 'failed', message: out.error, ...(out.step ? { step: out.step } : {}), ...checks, screen: out.result.lines };
    case 'signon':
    case 'host':
      return { status: 'error', message: out.error };
  }
}

/** A host connection for one run: no device name, or the next free one of the prefix. */
function leaseFrom(devices: DeviceNamePool | undefined): HostLease {
  let name = devices?.acquire();
  return {
    get deviceName() { return name; },
    nextDeviceName: (inUse, attempt) => {
      if (!devices) return undefined;
      devices.avoid(inUse);
      name = attempt <= 3 ? devices.acquire() : undefined;
      return name;
    },
    release: () => { if (name) devices?.release(name); name = undefined; },
  };
}

export type TestFormat = 'text' | 'github' | 'json';

export interface TestReport {
  results: CaseResult[];
  /** Tests files that can't be used, and macros named that don't exist. */
  problems: Array<{ file: string; message: string }>;
}

export function counts(results: readonly CaseResult[]): Record<CaseStatus, number> & { total: number } {
  const n = { passed: 0, failed: 0, error: 0, skipped: 0, total: results.length };
  for (const r of results) n[r.status]++;
  return n;
}

/** Whether the run should fail CI: a failure, an error, or a tests file that can't be used. */
export function failed(report: TestReport): boolean {
  return report.problems.length > 0 || report.results.some((r) => r.status === 'failed' || r.status === 'error');
}

const MARK: Record<CaseStatus, string> = { passed: '✓', failed: '✗', error: '!', skipped: '-' };

/** One result as a line, then its reason and failed checks, for the text report. */
export function resultLines(r: CaseResult): string[] {
  const title = r.name === r.label ? r.macro : `${r.macro} › ${r.name}`;
  const checks = r.checks?.length ? `, ${plural(r.checks.length, 'check')}` : '';
  const out = [`${MARK[r.status]} ${title}${r.status === 'skipped' ? ' (skipped)' : ` (${seconds(r.ms)}s${checks})`}`];
  if (r.message) out.push(`    ${r.message}`);
  if (r.status === 'failed') for (const c of r.checks ?? []) if (!c.passed) out.push(`    ✗ ${failureText(c)}`);
  return out;
}

export function summary(report: TestReport): string {
  const n = counts(report.results);
  const parts = [`${n.passed} passed`, n.failed && `${n.failed} failed`, n.error && `${plural(n.error, 'error')}`, n.skipped && `${n.skipped} skipped`].filter(Boolean);
  const files = report.problems.length ? ` ${plural(report.problems.length, 'tests file')} can't be used.` : '';
  return n.total === 0 && !files
    ? 'No macros to test: none has checks (expect or end) or a tests file.'
    : `${plural(n.total, 'test')}: ${parts.join(', ')}.${files}`;
}

/** The report for a person, GitHub Actions annotations, or JSON. */
export function formatTests(report: TestReport, format: TestFormat, dir = '.'): string {
  if (format === 'json') return JSON.stringify({ ...counts(report.results), ...report }, null, 2);
  const out: string[] = [];
  for (const p of report.problems) {
    out.push(format === 'github' ? `::error file=${property(repoPath(dir, p.file))},title=Veneer test::${escape(p.message)}` : `! ${p.file}\n    ${p.message}`);
  }
  for (const r of report.results) {
    out.push(...resultLines(r));
    if (format === 'github' && (r.status === 'failed' || r.status === 'error')) {
      const file = property(repoPath(dir, r.file ?? `macros/${r.macro}.json`));
      out.push(`::error file=${file},title=${property(`Veneer test ${r.macro} › ${r.name}`)}::${escape(r.message ?? r.status)}`);
    }
  }
  out.push(summary(report));
  return out.join('\n');
}

/** JUnit XML, as Jenkins, GitLab, Azure DevOps and most CI servers read it: a suite per macro, a test case per run. */
export function junitReport(report: TestReport, time = new Date()): string {
  const suites = new Map<string, CaseResult[]>();
  for (const r of report.results) suites.set(r.macro, [...(suites.get(r.macro) ?? []), r]);
  const all = counts(report.results);
  const total = report.results.reduce((s, r) => s + r.ms, 0);
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="Veneer macros" tests="${all.total + report.problems.length}" failures="${all.failed}" errors="${all.error + report.problems.length}" skipped="${all.skipped}" time="${seconds(total)}" timestamp="${time.toISOString()}">`,
  ];
  for (const [macro, list] of suites) {
    const n = counts(list);
    out.push(`  <testsuite name="${xml(macro)}" tests="${n.total}" failures="${n.failed}" errors="${n.error}" skipped="${n.skipped}" time="${seconds(list.reduce((s, r) => s + r.ms, 0))}">`);
    for (const r of list) {
      const open = `    <testcase classname="${xml(`veneer.${macro}`)}" name="${xml(r.name)}" time="${seconds(r.ms)}"`;
      if (r.status === 'passed' && !r.checks?.length) { out.push(`${open}/>`); continue; }
      out.push(`${open}>`);
      if (r.status === 'skipped') out.push(`      <skipped message="${xml(r.message ?? '')}"/>`);
      if (r.status === 'error') out.push(`      <error message="${xml(r.message ?? '')}" type="host"/>`);
      if (r.status === 'failed') {
        const detail = [...(r.checks ?? []).filter((c) => !c.passed).map(failureText), ...(r.screen?.length ? ['', 'The screen it stopped on:', ...r.screen] : [])];
        out.push(`      <failure message="${xml(r.message ?? '')}" type="${r.checks?.some((c) => !c.passed) ? 'check' : 'stopped'}">${xml(detail.join('\n'))}</failure>`);
      }
      if (r.checks?.length) out.push(`      <system-out>${xml(r.checks.map((c) => `${c.passed ? '✓' : '✗'} ${c.step ? `Step ${c.step}: ` : ''}${c.check} (“${c.actual}”)`).join('\n'))}</system-out>`);
      out.push('    </testcase>');
    }
    out.push('  </testsuite>');
  }
  if (report.problems.length) {
    out.push(`  <testsuite name="tests files" tests="${report.problems.length}" failures="0" errors="${report.problems.length}" skipped="0" time="0">`);
    for (const p of report.problems) out.push(`    <testcase classname="veneer.files" name="${xml(p.file)}" time="0">\n      <error message="${xml(p.message)}" type="file"/>\n    </testcase>`);
    out.push('  </testsuite>');
  }
  out.push('</testsuites>', '');
  return out.join('\n');
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const seconds = (ms: number) => (ms / 1000).toFixed(3);

/** XML text and attribute values: escaped, without the control characters XML 1.0 forbids. */
function xml(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** GitHub workflow commands need %, CR and LF escaped, and in a property , and : too. */
const escape = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const property = (s: string) => escape(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

/** A file in the screens folder, relative to the repository root, so annotations land on it. */
function repoPath(dir: string, file: string): string {
  const rel = path.relative(process.cwd(), dir) || '.';
  return path.posix.join(rel.split(path.sep).join('/'), file);
}
