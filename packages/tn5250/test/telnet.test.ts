import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TelnetCodec } from '../src/telnet.ts';

const IAC = 0xff, DO = 0xfd, WILL = 0xfb, SB = 0xfa, SE = 0xf0, EOR = 0xef;

function codec(deviceName?: string) {
  const sent: number[][] = [];
  const records: Buffer[] = [];
  const c = new TelnetCodec({
    terminalType: 'IBM-3179-2', deviceName,
    send: (b) => sent.push([...b]), onRecord: (r) => records.push(r),
  });
  return { c, sent, records };
}

test('agrees to TN5250 options and refuses others', () => {
  const { c, sent } = codec();
  c.receive(Buffer.from([IAC, DO, 0x18, IAC, DO, 0x19, IAC, WILL, 0x00, IAC, DO, 0x01]));
  assert.deepEqual(sent, [[IAC, WILL, 0x18], [IAC, WILL, 0x19], [IAC, DO, 0x00], [IAC, 0xfc, 0x01]]);
  c.receive(Buffer.from([IAC, DO, 0x18]));
  assert.equal(sent.length, 4, 'does not re-acknowledge an option already on');
});

test('answers TERMINAL-TYPE and NEW-ENVIRON requests', () => {
  const { c, sent } = codec('VENEER01');
  c.receive(Buffer.from([IAC, SB, 0x18, 0x01, IAC, SE]));
  assert.deepEqual(sent[0], [IAC, SB, 0x18, 0x00, ...Buffer.from('IBM-3179-2'), IAC, SE]);
  c.receive(Buffer.from([IAC, SB, 0x27, 0x01, 0x00, 0x03, IAC, SE]));
  assert.deepEqual(sent[1], [IAC, SB, 0x27, 0x00, 0x03, ...Buffer.from('DEVNAME'), 0x01, ...Buffer.from('VENEER01'), IAC, SE]);
});

test('frames records on IAC EOR across chunks and unescapes IAC', () => {
  const { c, records } = codec();
  c.receive(Buffer.from([0x00, 0x0a, IAC]));
  c.receive(Buffer.from([IAC, 0x01, IAC, EOR, 0x02, IAC, EOR]));
  assert.deepEqual(records.map((r) => [...r]), [[0x00, 0x0a, 0xff, 0x01], [0x02]]);
});

test('escapes IAC in outbound records', () => {
  const { c, sent } = codec();
  c.sendRecord(Buffer.from([0x01, 0xff, 0x02]));
  assert.deepEqual(sent[0], [0x01, IAC, IAC, 0x02, IAC, EOR]);
});
