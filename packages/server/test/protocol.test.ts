import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseClientMessage } from '../src/protocol.ts';

test('accepts well-formed messages', () => {
  assert.deepEqual(parseClientMessage('{"type":"hello"}'), { type: 'hello' });
  assert.deepEqual(
    parseClientMessage('{"type":"submit","aid":"F12","fields":{"6:53":"QUSER"},"cursor":{"row":6,"col":53}}'),
    { type: 'submit', aid: 'F12', fields: { '6:53': 'QUSER' }, cursor: { row: 6, col: 53 } },
  );
});

test('rejects malformed messages', () => {
  for (const raw of [
    'not json', '[]', '{"type":"nope"}', '{"type":"submit","aid":"F25"}',
    '{"type":"submit","aid":"Enter","fields":{"x":"1"}}',
    '{"type":"submit","aid":"Enter","fields":{"1:1":5}}',
    '{"type":"submit","aid":"Enter","cursor":{"row":0,"col":1}}',
    '{"type":"hello","resumeToken":7}',
  ]) {
    assert.throws(() => parseClientMessage(raw), Error, raw);
  }
});
