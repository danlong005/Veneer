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
