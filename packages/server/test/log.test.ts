import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { configureLog, log } from '../src/log.ts';

after(() => configureLog({ level: 'error' }));

test('writes JSON lines to a file and rotates by size, keeping a limited history', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veneer-log-'));
  const file = path.join(dir, 'logs', 'veneer.log');
  configureLog({ level: 'info', file, maxBytes: 300, keep: 2 });
  for (let i = 0; i < 20; i++) log.info('message', { i });
  log.debug('below the level');

  const files = fs.readdirSync(path.dirname(file)).sort();
  assert.deepEqual(files, ['veneer.log', 'veneer.log.1', 'veneer.log.2']);
  for (const f of files) assert.ok(fs.statSync(path.join(dir, 'logs', f)).size <= 300, `${f} within the limit`);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.at(-1).i, 19, 'newest entry in the current file');
  assert.ok(lines.every((l) => l.level === 'info'));
});

test('appends to an existing file and counts its size', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veneer-log-'));
  const file = path.join(dir, 'veneer.log');
  fs.writeFileSync(file, 'x'.repeat(250) + '\n');
  configureLog({ level: 'info', file, maxBytes: 300, keep: 1 });
  log.info('this line does not fit');
  assert.ok(fs.existsSync(`${file}.1`), 'rotated because the existing file was nearly full');
  assert.match(fs.readFileSync(file, 'utf8'), /this line does not fit/);
});

test('a record trace keeps what the browser sent out of the log', async () => {
  const { traceRecord } = await import('../src/sessions.ts');
  const { buildRecord } = await import('@veneer/tn5250');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veneer-log-'));
  const file = path.join(dir, 'veneer.log');
  configureLog({ level: 'info', file });
  // Out: cursor 7,53, Enter, then a field holding "SECRET" (EBCDIC e2c5c3d9c5e3).
  traceRecord({ id: 's1' }, 'out', buildRecord(0x00, [0x07, 0x35, 0xf1, 0x11, 0x07, 0x35, 0xe2, 0xc5, 0xc3, 0xd9, 0xc5, 0xe3]));
  traceRecord({ id: 's1' }, 'in', buildRecord(0x03, [0x04, 0x11, 0x00, 0x18]));
  const [out, inbound] = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(out.hex, '001612a0000004000000' + '0735f1');
  assert.equal(out.hidden, 9);
  assert.ok(!out.hex.includes('e2c5c3d9c5e3'));
  assert.equal(inbound.hex, '000e12a0000004000003' + '04110018');
  assert.equal(inbound.hidden, undefined);
});
