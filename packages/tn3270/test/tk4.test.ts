// Screens recorded from TK4- (MVS 3.8j on Hercules, plain TN3270), replayed
// through the terminal. Each fixture is the host's records from the last
// erase to the screen (test/fixtures/tk4.json; never what was typed). Any
// warning fails: these are streams a real host sent.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { getCodepage, type ScreenSnapshot } from '@veneer/terminal';
import { snapshot } from '../src/screen.ts';
import { Terminal } from '../src/terminal.ts';

const cp = getCodepage(37);
interface Fixture { note: string; model: number; records: string[] }
const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/tk4.json', import.meta.url), 'utf8')) as Record<string, Fixture>;

export function replay(name: string): ScreenSnapshot {
  const f = fixtures[name]!;
  const t = new Terminal({ codepage: cp, model: f.model, send3270: () => {}, sendSscpLu: () => {}, onWarning: (w) => { throw new Error(`${name}: ${w}`); } });
  for (const hex of f.records) t.processRecord(Buffer.from(hex, 'hex'));
  return snapshot(t.screen, cp);
}
const inputs = (s: ScreenSnapshot) => s.fields.filter((f) => !f.bypass);
const at = (s: ScreenSnapshot) => `${s.cursor.row}:${s.cursor.col}`;

test('every recorded TK4- screen replays without a warning and leaves the keyboard unlocked', () => {
  assert.ok(Object.keys(fixtures).length >= 8);
  for (const name of Object.keys(fixtures)) assert.equal(replay(name).keyboardLocked, false, name);
});

test('the VTAM logon screen: one input after "Logon ===>", cursor in it', () => {
  const s = replay('vtamLogon');
  assert.match(s.lines[22]!, /^Logon ===>/);
  assert.deepEqual(inputs(s).map((f) => [f.id, f.length]), [['23:12', 128]]);
  assert.equal(at(s), '23:12');
  assert.match(s.lines.join('\n'), /MVS 3\.8j Level 8505/);
});

test('TSO asks for the password in a hidden line-mode field', () => {
  const s = replay('tsoPassword');
  assert.match(s.lines[0]!, /ENTER CURRENT PASSWORD FOR HERC01-/);
  const typing = inputs(s).find((f) => f.id === at(s))!;
  assert.equal(typing.attr.nonDisplay, true);
  assert.equal(s.fields.some((f) => f.bypass), false, 'line mode: no protected fields');
});

test('the TSO Applications menu, on a model 2 and (Erase/Write Alternate) on a model 5', () => {
  const two = replay('tsoMenu');
  assert.deepEqual([two.rows, two.cols], [24, 80]);
  assert.deepEqual(inputs(two).map((f) => [f.id, f.length]), [['5:14', 1]]);
  assert.match(two.lines[18]!, /7 {2}TERMTEST {3}verify 3270 terminal capabilities/);
  assert.ok(two.segments.flat().some((seg) => seg.attr.color === 'turquoise'), 'extended colour, as the query reply allowed');

  const five = replay('tsoMenuModel5');
  assert.ok(fixtures.tsoMenuModel5!.records.some((r) => r.startsWith('7e')), 'sent with Erase/Write Alternate');
  assert.deepEqual([five.rows, five.cols], [27, 132]);
  assert.equal(five.lines[4]!.slice(0, 14), ' Option ===> 1');
});

test('TSO line mode: READY under a boxed message, and LISTCAT paused at ***', () => {
  const ready = replay('tsoReady');
  assert.equal(ready.lines[4]!.trim(), 'READY');
  assert.equal(ready.fields.some((f) => f.bypass), false, 'every field unprotected, output included');
  const last = inputs(ready).at(-1)!;
  assert.equal((last.row - 1) * 80 + last.col - 1 + last.length, 1919, 'the input runs to the end of the screen');
  assert.equal(at(ready), '6:1', 'the cursor is in it, on the next line');

  const listcat = replay('tsoListcat');
  assert.equal(listcat.lines[23]!.trim(), '***');
  assert.equal(at(listcat), '24:6');
  assert.match(listcat.lines.join('\n'), /NONVSAM ------- SYS1\.ACMDLIB/);
});

test('RFE\'s data set list: Set Attribute orders colour characters inside fields', () => {
  const s = replay('rfeDslist');
  assert.match(s.lines[0]!, /RFE DSLIST .* Row 1 of 129/);
  assert.equal(s.lines[3]!.slice(1, 3), "' ", 'RFE marks the selection column with an apostrophe (0x7D)');
  const select = s.fields.find((f) => f.id === '4:2')!;
  assert.equal(select.bypass, false);
  assert.equal(select.length, 1);
  const name = s.segments[3]!.find((seg) => seg.text.includes('SYS1.ACMDLIB'));
  assert.ok(name, 'the data set name');
});

test('TERMTEST shows TSO read the query reply: size, query bit, structured fields', () => {
  const s = replay('termtest');
  const text = s.lines.join('\n');
  assert.match(text, /GTSIZE .* 24 LINES {3}80 COLUMNS/);
  assert.match(text, /EBCDIC TERMINAL {2}QUERY BIT ON/);
  assert.match(text, /3270DS STRUC\. FIELD SUPPORTED/);
  assert.match(text, /QUERY LIST IS SUPPORTED/);
});
