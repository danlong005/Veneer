import assert from 'node:assert/strict';
import { test } from 'node:test';
import { screenId } from '@veneer/screens';
import { Attr, HostStream, Terminal, buildRecord, getCodepage } from '@veneer/tn5250';
import { snapshot } from '@veneer/tn5250';
import { HelpReader, helpPage } from '../src/help/help.ts';
import { transform } from '../src/transform/index.ts';
import { orderEntry } from './screens.ts';

const cp = getCodepage(37);
const { WHITE, BLUE } = Attr;

/** Screens drawn one after another on one terminal, as the host sends them. */
function terminal() {
  const t = new Terminal({ codepage: cp, terminalType: 'IBM-3179-2', sendRecord: () => {} });
  const draw = (build: (s: HostStream) => HostStream) => {
    t.processRecord(buildRecord(0x03, build(new HostStream()).build()));
    return transform(snapshot(t.screen, cp));
  };
  return { draw, error: (text: string) => draw((s) => s.errorMessage(text)) };
}

const order = (s: HostStream) => s.clear().write().text(1, 34, 'Order Entry', WHITE)
  .text(6, 4, 'Quantity . . . .').field(6, 22, 6).text(22, 2, 'F3=Exit   F12=Cancel', BLUE).readMdt();

/** A UIM-style help window: its heading inside, a paging marker and keys at the bottom. */
const helpWindow = (lines: string[], marker: string) => (s: HostStream) => {
  s.write().text(12, 8, '.'.repeat(58), BLUE);
  for (let r = 13; r <= 21; r++) s.text(r, 8, ':', BLUE).fill(r, 10, 54).text(r, 65, ':', BLUE);
  s.text(22, 8, ':' + '.'.repeat(56) + ':', BLUE);
  // The heading is highlighted, as on IBM i.
  lines.forEach((l, i) => s.text(13 + i, 11, l, i === 0 ? WHITE : undefined));
  return s.text(20, 55, marker).text(21, 11, 'F2=Extended help   F12=Cancel', BLUE);
};

test('reads a help window: heading, re-joined paragraphs, paging marker; keys left out', () => {
  const t = terminal();
  t.draw(order);
  const view = t.draw(helpWindow(['Quantity - Help', '', 'How many items to ship. Type a', 'negative number for a return.', '', 'Whole numbers only.', '  * No decimals'], 'More...'));
  assert.ok(view.window, 'drawn as a window');
  assert.deepEqual(helpPage(view), {
    title: 'Quantity - Help',
    paragraphs: ['How many items to ship. Type a negative number for a return.', 'Whole numbers only.', '* No decimals'],
    more: true,
  });
  assert.equal(helpPage(t.draw(helpWindow(['Quantity - Help', '', 'Last page.'], 'Bottom'))).more, false);
});

test('reads full-screen help: the title row is the title', () => {
  const t = terminal();
  const view = t.draw((s) => s.clear().write().text(1, 32, 'Main Menu - Help', WHITE)
    .text(3, 2, 'The main menu lists what you can do.').text(4, 2, 'Type an option number.')
    .text(20, 73, 'Bottom').text(22, 2, 'F3=Exit help   F12=Cancel', BLUE));
  assert.deepEqual(helpPage(view), { title: 'Main Menu - Help', paragraphs: ['The main menu lists what you can do. Type an option number.'], more: false });
});

test('the reader: Help, show, page, close back to the screen', () => {
  const t = terminal();
  const origin = t.draw(order);
  const id = screenId(origin.snapshot);
  const r = new HelpReader(id);
  assert.deepEqual(r.start(), { send: 'Help' });
  const shown = r.onScreen(t.draw(helpWindow(['Quantity - Help', '', 'Page one.'], 'More...')), 'help-1');
  assert.ok('show' in shown && shown.show.more && shown.show.paragraphs[0] === 'Page one.');
  assert.deepEqual(r.more(), { send: 'PageDown' });
  const two = r.onScreen(t.draw(helpWindow(['Quantity - Help', '', 'Page two.'], 'Bottom')), 'help-2');
  assert.ok('show' in two && !two.show.more);
  // Paging past the end: the host refuses; keep the page, without More.
  r.more();
  const refused = r.onScreen(t.error('Already at bottom.'), 'help-2', true);
  assert.ok('show' in refused && refused.reset && !refused.show.more && refused.show.paragraphs[0] === 'Page two.');
  assert.deepEqual(r.close(), { send: 'F12' });
  assert.equal(r.close(), null, 'already closing');
  assert.deepEqual(r.onScreen(t.draw(order), id), { done: true, back: true });
});

test('the reader: help that will not close is tried with F3, then given up', () => {
  const r = new HelpReader('origin');
  r.onScreen(terminal().draw(helpWindow(['X - Help', '', 'Text.'], 'Bottom')), 'help');
  assert.deepEqual(r.close(), { send: 'F12' });
  assert.deepEqual(r.onScreen(terminal().draw(helpWindow(['X - Help', '', 'Text.'], 'Bottom')), 'help'), { send: 'F3' });
  assert.deepEqual(r.onScreen(terminal().draw(helpWindow(['Extended help'], 'Bottom')), 'help-ext'), { send: 'F12' });
  const last = r.onScreen(terminal().draw(helpWindow(['Extended help'], 'Bottom')), 'help-ext');
  assert.ok('done' in last && !last.back && /did not close/.test(last.message!));
});

test('the reader: no help, an error, and closing before the help arrives', () => {
  const t = terminal();
  const origin = t.draw(order);
  const id = screenId(origin.snapshot);
  const none = new HelpReader(id);
  none.start();
  assert.deepEqual(none.onScreen(origin, id), { done: true, back: true, message: 'There is no help for this screen.' });

  const refused = new HelpReader(id);
  refused.start();
  const err = refused.onScreen(t.error('CPD9001 - Help is not available for this display.'), id, true);
  assert.deepEqual(err, { done: true, back: true }, 'the host error stays showing, as on a terminal');

  const early = new HelpReader(id);
  early.start();
  assert.equal(early.close(), null, 'nothing to close yet');
  assert.deepEqual(early.onScreen(t.draw(helpWindow(['Q - Help', '', 'Text.'], 'Bottom')), 'help'), { send: 'F12' }, 'closed as soon as it shows');
  assert.deepEqual(early.onScreen(t.draw(order), id), { done: true, back: true });
});

test('help is read from a real-looking order entry screen too', () => {
  assert.equal(helpPage(transform(orderEntry())).title, 'Order Entry');
});
