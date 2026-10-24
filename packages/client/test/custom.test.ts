import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectHost, emitScreen, runScreenScript, runSiteScript, veneer, type ScreenInfo } from '../src/custom/runtime.ts';

const element = {} as HTMLElement;
const screen: ScreenInfo = { id: 'abc123', rows: 24, cols: 80, lines: [], fields: [{ id: '6:53', row: 6, col: 53, length: 10, value: 'X' }] };

test('screen scripts get veneer and the screen element, and may return a cleanup', () => {
  const calls: string[] = [];
  connectHost({
    getField: (id) => (id === '6:53' ? 'X' : undefined),
    setField: (id, value) => calls.push(`set ${id}=${value}`),
    press: (aid) => calls.push(`press ${aid}`),
  });
  const result = runScreenScript(
    "veneer.setField('6:53', veneer.getField('6:53') + 'Y'); screen.seen = true; return () => veneer.press('F3');",
    element, 'test',
  );
  assert.equal((element as unknown as { seen: boolean }).seen, true);
  assert.deepEqual(calls, ['set 6:53=XY']);
  result.cleanup!();
  assert.deepEqual(calls, ['set 6:53=XY', 'press F3']);
});

test('script errors are reported, not thrown', () => {
  const orig = console.error;
  console.error = () => {};
  try {
    assert.match(runScreenScript('nope(', element, 'test').error!, /token|Unexpected/i);
    assert.equal(runScreenScript('throw new Error("boom")', element, 'test').error, 'boom');
    assert.equal(runSiteScript('throw new Error("site")').error, 'site');
  } finally {
    console.error = orig;
  }
});

test('veneer.on("screen") handlers run per screen; a late global.js sees the current screen', () => {
  const seen: string[] = [];
  const off = veneer.on('screen', (s) => seen.push(s.id));
  emitScreen(screen, element);
  off();
  emitScreen({ ...screen, id: 'def456' }, element);
  assert.deepEqual(seen, ['abc123']);
  assert.equal(veneer.screen?.id, 'def456');

  const g = globalThis as unknown as { late?: string };
  runSiteScript("veneer.on('screen', (s) => { globalThis.late = s.id; })");
  assert.equal(g.late, 'def456');
  delete g.late;
});
