import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { recordScreen, screenId, validateDefinition } from '@veneer/screens';
import type { ScreenSnapshot } from '@veneer/terminal';
import { Attr, HostStream, Terminal, buildRecord, getCodepage, snapshot } from '@veneer/tn5250';
import { checkFolder, formatReport } from '../src/checkFolder.ts';
import { MatchLog } from '../src/matchLog.ts';
import { ScreenStore } from '../src/store.ts';

const cp = getCodepage(37);
function screen(build: (s: HostStream) => HostStream): ScreenSnapshot {
  const t = new Terminal({ codepage: cp, terminalType: 'IBM-3179-2', sendRecord: () => {} });
  t.processRecord(buildRecord(0x03, build(new HostStream().clear().write()).readMdt().build()));
  return snapshot(t.screen, cp);
}
const inquiry = screen((s) => s.text(1, 33, 'Order Inquiry', Attr.WHITE).text(4, 2, 'Order number').field(4, 30, 9, { value: 'SECRET1' }));
const recompiled = screen((s) => s.text(1, 33, 'Order Inquiry', Attr.WHITE).text(4, 2, 'Order number').field(4, 31, 10));

const definition = {
  id: 'order-inquiry', name: 'Order inquiry',
  match: { screenIds: [screenId(inquiry)], text: [] },
  changes: [{ op: 'widget', field: '4:30', widget: { type: 'select', options: [{ value: '1', label: 'One' }] } }],
};

function folder(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veneer-check-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

const recording = (snap: ScreenSnapshot) => ({ name: 'order-inquiry', definition: 'order-inquiry', screen: recordScreen(snap) });

test('a folder whose definitions match their recorded screens passes', async () => {
  const dir = folder({ 'order-inquiry.json': definition, 'snapshots/order-inquiry.json': recording(inquiry), 'global.style.json': {} });
  const result = await checkFolder(dir);
  assert.deepEqual(result.findings, []);
  assert.equal(formatReport(result, dir, 'text'), 'Checked 1 definition, 0 macros and 1 recorded screen: no problems.');
});

test('broken files, misnamed files and changed screens are errors', async () => {
  const dir = folder({
    'order-inquiry.json': definition,
    'broken.json': '{"id": ',
    'wrong-name.json': { ...definition, id: 'other' },
    'macros/bad.json': { name: 'bad', label: 'Bad', steps: [] },
    'snapshots/order-inquiry.json': recording(recompiled),
  });
  const result = await checkFolder(dir);
  const lines = result.findings.map((f) => `${f.level} ${f.file}: ${f.message}`);
  assert.equal(lines.length, 4, lines.join('\n'));
  assert.match(lines[0]!, /^error broken\.json: It is not valid JSON/);
  assert.equal(lines[1], 'error wrong-name.json: Its name is "other", so the file must be called other.json.');
  assert.equal(lines[2], 'error macros/bad.json: steps: needs at least one step');
  assert.match(lines[3]!, /^error order-inquiry\.json: It no longer matches its recorded screen \(snapshots\/order-inquiry\.json\): its screen ID is now/);

  const github = formatReport(result, dir, 'github');
  assert.match(github, /^::error file=.*\/broken\.json,title=Veneer check::It is not valid JSON/m);
});

test('veneer check exits 1 on errors, 0 on warnings unless --strict, 2 on bad usage', () => {
  const script = fileURLToPath(new URL('../src/check.ts', import.meta.url));
  const run = (...args: string[]) => {
    try {
      execFileSync(process.execPath, ['--conditions=veneer-source', script, ...args], { stdio: 'pipe', env: { ...process.env, GITHUB_ACTIONS: '' } });
      return 0;
    } catch (err) {
      return (err as { status: number }).status;
    }
  };
  const ok = folder({ 'order-inquiry.json': definition, 'snapshots/order-inquiry.json': recording(inquiry) });
  const broken = folder({ 'order-inquiry.json': definition, 'snapshots/order-inquiry.json': recording(recompiled) });
  // Only a warning: no recorded screen matches the definition.
  const warned = folder({ 'order-inquiry.json': definition, 'snapshots/other.json': { name: 'other', screen: recordScreen(recompiled) } });
  assert.equal(run(ok), 0);
  assert.equal(run(broken), 1);
  assert.equal(run(warned), 0);
  assert.equal(run(warned, '--strict'), 1);
  assert.equal(run(path.join(ok, 'missing')), 2);
  assert.equal(run(ok, '--format', 'xml'), 2);
});

test('the store records screens without what was typed', async () => {
  const dir = folder({ 'order-inquiry.json': definition });
  const store = new ScreenStore(dir);
  await store.load();
  const saved = await store.saveRecording({ name: 'order-inquiry', definition: 'order-inquiry', screen: inquiry });
  assert.ok(saved.recorded);
  const text = fs.readFileSync(path.join(dir, 'snapshots/order-inquiry.json'), 'utf8');
  assert.ok(!text.includes('SECRET1'));
  assert.deepEqual((await store.listRecordings()).map((r) => [r.name, r.definition]), [['order-inquiry', 'order-inquiry']]);
  await assert.rejects(store.saveRecording({ name: 'x', definition: 'no-such-thing', screen: inquiry }), /no definition "no-such-thing"/);
  // The recorded screen is not taken for a definition.
  await store.load();
  assert.deepEqual(store.list().map((d) => d.id), ['order-inquiry']);
  assert.deepEqual((await checkFolder(dir)).findings, []);
});

test('the match log lists definitions no screen has matched since startup first', () => {
  const defs = [validateDefinition(definition), validateDefinition({ ...definition, id: 'unused', name: 'Unused', match: { screenIds: ['0123456789abcd'], text: [] } })];
  const log = new MatchLog(() => defs);
  assert.deepEqual(log.list().map((d) => [d.id, d.lastMatched]), [['order-inquiry', null], ['unused', null]]);
  log.record(inquiry);
  log.record(recompiled);
  const list = log.list();
  assert.deepEqual(list.map((d) => d.id), ['unused', 'order-inquiry']);
  assert.equal(list[0]!.lastMatched, null);
  assert.ok(list[1]!.lastMatched);
  // On a mainframe server, IBM i definitions are left out.
  const ibmi = validateDefinition({ ...definition, id: 'ibmi-only', host: '5250' });
  assert.deepEqual(new MatchLog(() => [...defs, ibmi], '3270').list().map((d) => d.id), ['order-inquiry', 'unused']);
});

test('the demo screens folder passes veneer check (npm run demo:record refreshes its recordings)', async () => {
  const result = await checkFolder(fileURLToPath(new URL('../dev/screens', import.meta.url)));
  assert.deepEqual(result.findings, []);
  // Every definition's screen, and the main menu the demo macros start from.
  assert.equal(result.recordings, result.definitions + 1);
  assert.ok(result.macros >= 2);
});
