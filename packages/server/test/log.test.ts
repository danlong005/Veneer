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

test('a 3270 record trace keeps typed text out of the log too, with or without TN3270E', async () => {
  const { traceRecord } = await import('../src/sessions.ts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veneer-log-'));
  const file = path.join(dir, 'veneer.log');
  configureLog({ level: 'info', file });
  const SECRET = [0xe2, 0xc5, 0xc3, 0xd9, 0xc5, 0xe3];
  // Plain TN3270, as TK4- sends it: Enter, cursor, then SBA and a password field.
  traceRecord({ id: 's1' }, 'out', Buffer.from([0x7d, 0xc5, 0xc1, 0x11, 0xc5, 0xc1, ...SECRET]), '3270');
  // TN3270E 3270 data: the 5-byte header, then the same.
  traceRecord({ id: 's1' }, 'out', Buffer.from([0x00, 0x00, 0x00, 0x00, 0x01, 0x7d, 0xc5, 0xc1, 0x11, 0xc5, 0xc1, ...SECRET]), '3270');
  // TN3270E SSCP-LU data: what was typed on the logon screen, all of it text.
  traceRecord({ id: 's1' }, 'out', Buffer.from([0x07, 0x00, 0x00, 0x00, 0x02, ...SECRET]), '3270');
  // A short read (PA1) and a query reply are shown as they are, up to the cursor.
  traceRecord({ id: 's1' }, 'out', Buffer.from([0x6c]), '3270');
  traceRecord({ id: 's1' }, 'in', Buffer.from([0xf5, 0xc3, 0x11, 0x40, 0x40, ...SECRET]), '3270');
  const [plain, extended, sscp, pa1, inbound] = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const secret = Buffer.from(SECRET).toString('hex');
  assert.deepEqual([plain.hex, plain.hidden], ['7dc5c1', 9]);
  assert.deepEqual([extended.hex, extended.hidden], ['00000000017dc5c1', 9]);
  assert.deepEqual([sscp.hex, sscp.hidden], ['0700000002', 6]);
  assert.deepEqual([pa1.hex, pa1.hidden], ['6c', undefined]);
  for (const r of [plain, extended, sscp]) assert.ok(!r.hex.includes(secret));
  assert.ok(inbound.hex.endsWith(secret), 'what the host sends is all logged');
});
