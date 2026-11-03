import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseClientMessage } from '../src/protocol.ts';

test('accepts well-formed messages', () => {
  assert.deepEqual(parseClientMessage('{"type":"hello"}'), { type: 'hello' });
  assert.deepEqual(
    parseClientMessage('{"type":"submit","aid":"F12","fields":{"6:53":"QUSER"},"cursor":{"row":6,"col":53}}'),
    { type: 'submit', aid: 'F12', fields: { '6:53': 'QUSER' }, cursor: { row: 6, col: 53 } },
  );
  assert.deepEqual(parseClientMessage('{"type":"macro","macro":"order-inquiry","outcome":"failed","step":3,"order":"123"}'),
    { type: 'macro', macro: 'order-inquiry', outcome: 'failed', step: 3 }, 'anything else is dropped');
  assert.deepEqual(parseClientMessage('{"type":"signon","user":"dlong","password":"pw","program":"","menu":"main","extra":1}'),
    { type: 'signon', user: 'dlong', password: 'pw', menu: 'main' }, 'blank and unknown parts dropped');
});

test('rejects malformed messages', () => {
  for (const raw of [
    'not json', '[]', '{"type":"nope"}', '{"type":"submit","aid":"F25"}',
    '{"type":"submit","aid":"Enter","fields":{"x":"1"}}',
    '{"type":"submit","aid":"Enter","fields":{"1:1":5}}',
    '{"type":"submit","aid":"Enter","cursor":{"row":0,"col":1}}',
    '{"type":"hello","resumeToken":7}',
    '{"type":"macro","macro":"Order Inquiry","outcome":"done"}',
    '{"type":"macro","macro":"order-inquiry","outcome":"great"}',
    '{"type":"macro","macro":"order-inquiry","outcome":"failed","step":0}',
    '{"type":"signon","user":"DLONG"}',
    '{"type":"signon","user":"TOOLONGUSERNAME","password":"x"}',
    `{"type":"signon","user":"DLONG","password":"${'x'.repeat(129)}"}`,
    '{"type":"signon","user":"DLONG","password":"x","library":7}',
  ]) {
    assert.throws(() => parseClientMessage(raw), Error, raw);
  }
});
