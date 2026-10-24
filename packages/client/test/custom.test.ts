import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectHost, declaredFunctions, notifyScreen, runScript, runSiteScript, setScreen, veneer, type ScreenInfo } from '../src/custom/runtime.ts';

const element = {} as HTMLElement;
const screen: ScreenInfo = { id: 'abc123', rows: 24, cols: 80, lines: [], fields: [{ id: '6:53', row: 6, col: 53, length: 10, value: 'X' }] };

test('scripts get veneer, the screen and the element, and may return a cleanup', () => {
  const calls: string[] = [];
  connectHost({
    getField: (id) => (id === '6:53' ? 'X' : undefined),
    setField: (id, value) => calls.push(`set ${id}=${value}`),
    press: (aid) => calls.push(`press ${aid}`),
  });
  setScreen(screen, element);
  const result = runScript(
    "veneer.setField('6:53', veneer.getField('6:53') + screen.id); element.seen = true; return () => veneer.press('F3');",
    'test',
  );
  assert.equal((element as unknown as { seen: boolean }).seen, true);
  assert.deepEqual(calls, ['set 6:53=Xabc123']);
  result.cleanup!();
  assert.deepEqual(calls, ['set 6:53=Xabc123', 'press F3']);
});

test('an HTML box script gets the box as `element`', () => {
  const box = {} as HTMLElement & { hit?: boolean };
  assert.deepEqual(runScript('element.hit = true', 'box', box), {});
  assert.equal(box.hit, true);
});

test('functions a script declares are global while it is active, for onclick="…"', () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const result = runScript("function doMessage() { return 'hi'; }\nasync function later() {}\nreturn () => {};", 'box');
  assert.equal((g.doMessage as () => string)(), 'hi');
  assert.equal(typeof g.later, 'function');
  result.cleanup!();
  assert.equal(g.doMessage, undefined, 'removed when the script is cleaned up');
  assert.equal(g.later, undefined);

  // Even a script that returns early still exports (declarations are hoisted).
  const early = runScript('return;\nfunction hoisted() {}', 'box');
  assert.equal(typeof g.hoisted, 'function');
  early.cleanup!();
  assert.deepEqual(declaredFunctions('const f = function () {}; x.function(); function a(){} {function b() {}}'), ['a', 'b']);
});

test('script errors are reported, not thrown', () => {
  const orig = console.error;
  console.error = () => {};
  try {
    assert.match(runScript('nope(', 'test').error!, /token|Unexpected/i);
    assert.equal(runScript('throw new Error("boom")', 'test').error, 'boom');
    assert.equal(runSiteScript('throw new Error("site")').error, 'site');
  } finally {
    console.error = orig;
  }
});

test('veneer.on("screen") handlers run per screen; a late global.js sees the current screen', () => {
  const seen: string[] = [];
  const off = veneer.on('screen', (s) => seen.push(s.id));
  setScreen(screen, element);
  notifyScreen();
  off();
  setScreen({ ...screen, id: 'def456' }, element);
  notifyScreen();
  assert.deepEqual(seen, ['abc123']);
  assert.equal(veneer.screen?.id, 'def456');

  const g = globalThis as unknown as { late?: string };
  runSiteScript("veneer.on('screen', (s) => { globalThis.late = s.id; })");
  assert.equal(g.late, 'def456');
  delete g.late;
});
