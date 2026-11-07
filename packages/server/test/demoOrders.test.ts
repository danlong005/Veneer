// The demo's screens for the widgets and components the other demo screens
// don't show: the orders list (displays and totals, calendar, board, charts),
// Order Status, Delivery Options, the bill of materials and the contacts map,
// and the documents server Order Status embeds.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { matchScreen, validateDefinition, type ScreenDefinition } from '@veneer/screens';
import { type ScreenSnapshot } from '@veneer/terminal';
import { Session, Terminal, buildRecord, getCodepage, snapshot } from '@veneer/tn5250';
import { listData } from '../../client/src/custom/components.ts';
import { listOf, tablePage } from '../../client/src/export/exporter.ts';
import { exportColumns } from '../../client/src/export/sheet.ts';
import { customize } from '../../client/src/transform/customize.ts';
import { transform } from '../../client/src/transform/index.ts';
import * as chart from '../dev/components/bar-chart.js';
import * as board from '../dev/components/board.js';
import * as calendar from '../dev/components/calendar.js';
import * as embed from '../dev/components/embed.js';
import * as pins from '../dev/components/pin-map.js';
import * as timeline from '../dev/components/timeline.js';
import * as totals from '../dev/components/totals.js';
import * as tree from '../dev/components/tree.js';
import { DOCS_PORT, docsPage, linesOf, startDocsServer } from '../dev/demoDocs.ts';
import { CONTACTS, CONTACTS_PAGE, DemoHost, contacts } from '../dev/demoHost.ts';
import {
  BOM, BOM_PAGE, CARRIER_LIST, DEFAULT_ORDER, ORDERS, ORDERS_PAGE, ORDER_VIEWS, billOfMaterials, checkDelivery, deliveryOptions,
  findOrder, mdy, orderStatus, orders, trackingOf, type OrderView,
} from '../dev/demoOrders.ts';

const cp = getCodepage(37);
const screensDir = new URL('../dev/screens/', import.meta.url);
const TODAY = new Date(2026, 10, 7); // Nov 7, 2026

function screen(stream: number[]): ScreenSnapshot {
  const t = new Terminal({ codepage: cp, terminalType: 'IBM-3179-2', sendRecord: () => {} });
  t.processRecord(buildRecord(0x03, stream));
  return snapshot(t.screen, cp);
}

const definitions: ScreenDefinition[] = fs.readdirSync(screensDir)
  .filter((f) => f.endsWith('.json') && !f.startsWith('global'))
  .map((f) => validateDefinition(JSON.parse(fs.readFileSync(new URL(f, screensDir), 'utf8'))));
const def = (id: string) => definitions.find((d) => d.id === id)!;
type Component = { op: 'component'; name: string; field?: string; at: { row: number; col: number }; width: number; height: number; options?: Record<string, unknown> };
const components = (id: string) => def(id).changes.filter((c): c is Component => c.op === 'component');
const component = (id: string, name: string) => components(id).find((c) => c.name === name)!;

/** The whole list, as readList gives it to a component: every page's rows. */
function wholeList(id: string, pages: ScreenSnapshot[]) {
  const tables = pages.map((snap) => listOf(customize(transform(snap), def(id)))!);
  return listData(tables[0]!, tables.map((t) => tablePage(t, exportColumns(t))), 0, true);
}
const orderPages = (view: OrderView) =>
  Array.from({ length: Math.ceil(ORDERS.length / ORDERS_PAGE) }, (_, p) => screen(orders(p, view, undefined, TODAY)));

const VIEW_IDS: Record<OrderView, string> = { list: 'demo-orders', calendar: 'demo-orders-calendar', board: 'demo-orders-board', chart: 'demo-orders-chart' };

// ---- matching

test('each orders title matches its own definition, on every page', () => {
  for (const view of Object.keys(ORDER_VIEWS) as OrderView[]) {
    for (const snap of orderPages(view)) assert.equal(matchScreen(snap, definitions)?.id, VIEW_IDS[view], view);
  }
});

test('order status, delivery options, the bill of materials and the contacts map match their definitions', () => {
  assert.equal(matchScreen(screen(orderStatus(DEFAULT_ORDER)), definitions)?.id, 'demo-order-status');
  assert.equal(matchScreen(screen(deliveryOptions(DEFAULT_ORDER)), definitions)?.id, 'demo-delivery-options');
  for (let p = 0; p * BOM_PAGE < BOM.length; p++) assert.equal(matchScreen(screen(billOfMaterials(p)), definitions)?.id, 'demo-bill-of-materials');
  for (let p = 0; p * CONTACTS_PAGE < CONTACTS.length; p++) {
    assert.equal(matchScreen(screen(contacts(p, undefined, 'map')), definitions)?.id, 'demo-contacts-map');
    assert.equal(matchScreen(screen(contacts(p)), definitions)?.id, 'demo-contacts', 'the cards view is unchanged');
  }
});

test('every component in the new definitions has valid options and fits the 24 x 80 screen', async () => {
  for (const id of [...Object.values(VIEW_IDS), 'demo-order-status', 'demo-delivery-options', 'demo-bill-of-materials', 'demo-contacts-map']) {
    for (const c of components(id)) {
      assert.ok(c.at.row + c.height - 1 <= 24 && c.at.col + c.width - 1 <= 80, `${id} ${c.name} fits`);
      const mod = await import(`../dev/components/${c.name}.js`) as { settings?: (o: unknown) => { error?: string } };
      if (mod.settings) assert.equal(mod.settings(c.options ?? {}).error ?? '', '', `${id} ${c.name}`);
    }
  }
});

// ---- the orders list

test('the orders list has the columns the definitions name, and its rows', () => {
  const list = wholeList('demo-orders', orderPages('list'));
  assert.deepEqual(list.columns, ['Order', 'Customer', 'Ship date', 'Status', 'Lines', 'Picked', 'Amount']);
  assert.equal(list.records.length, ORDERS.length, 'every order, from both pages');
  const [first] = list.records;
  assert.deepEqual(first!.cells, ['104571', 'Lakeside Hardware', mdy(new Date(2026, 10, 1)), 'DLV', '4', '100', '1,250.00']);
  assert.deepEqual(list.options.map((o) => o.value), ['5', '8']);
});

test('the totals count the orders and those on hold, and add up the amounts', () => {
  const list = wholeList('demo-orders', orderPages('list'));
  const s = totals.settings(component('demo-orders', 'totals').options);
  const shown = s.totals.map((t: unknown) => totals.compute(list, t, 'en-US'));
  assert.equal(shown[0].value, ORDERS.length);
  assert.equal(shown[1].value, ORDERS.filter((o) => o.status === 'HLD').length);
  assert.equal(Math.round(shown[2].value * 100), Math.round(ORDERS.reduce((t, o) => t + o.amount, 0) * 100));
  assert.equal(shown[2].text, '$25,932.19');
  assert.ok(shown.every((t: { error?: string }) => !t.error));
});

test('the calendar puts every order on its ship date, around today', () => {
  const list = wholeList('demo-orders-calendar', orderPages('calendar'));
  const { events, unread } = calendar.eventsOf(list, calendar.settings(component('demo-orders-calendar', 'calendar').options));
  assert.equal(unread, 0, 'every date reads with the MM/DD/YY format');
  assert.equal(events.length, ORDERS.length);
  assert.deepEqual(events.slice(0, 2).map((e: { iso: string; title: string }) => [e.iso, e.title]), [['2026-11-01', 'Lakeside Hardware'], ['2026-11-04', 'Harbor Supply Co']]);
  assert.ok(events.some((e: { iso: string }) => e.iso === '2026-11-07'), 'one ships today');
});

test('the board puts each order in its status\'s lane', () => {
  const list = wholeList('demo-orders-board', orderPages('board'));
  const { lanes } = board.lanesOf(list, board.settings(component('demo-orders-board', 'board').options));
  assert.deepEqual(lanes.map((l: { label: string; cards: unknown[] }) => [l.label, l.cards.length]),
    [['Ordered', 5], ['Picking', 3], ['Shipped', 2], ['Delivered', 2], ['On hold', 2]]);
});

test('the charts have a bar and a slice for every order', () => {
  const list = wholeList('demo-orders-chart', orderPages('chart'));
  const [bars, donut] = components('demo-orders-chart');
  const b = chart.chartData(list, chart.settings(bars!.options));
  assert.equal(b.points.length, ORDERS.length);
  assert.deepEqual(b.points.slice(0, 2).map((p: { name: string; values: number[] }) => [p.name, p.values[0]]), [['104571', 1250], ['104572', 318.4]]);
  const d = chart.settings(donut!.options);
  assert.equal(d.type, 'donut');
  assert.equal(chart.chartData(list, d).points[0].name, 'Lakeside Hardware');
});

// ---- the bill of materials

test('the bill of materials reads as a tree of three levels, across its pages', () => {
  const pages = Array.from({ length: Math.ceil(BOM.length / BOM_PAGE) }, (_, p) => screen(billOfMaterials(p)));
  assert.ok(pages.length >= 3);
  const list = wholeList('demo-bill-of-materials', pages);
  assert.deepEqual(list.columns, ['Lvl', 'Component', 'Description', 'Qty', 'UOM']);
  const { nodes: roots } = tree.buildTree(list, tree.settings(component('demo-bill-of-materials', 'tree').options));
  type Node = { name: string; children: Node[] };
  const names = (nodes: Node[]) => nodes.map((n) => n.name);
  assert.deepEqual(names(roots), ['FRAME-200', 'WHEEL-F', 'WHEEL-R', 'DRIVETRAIN', 'BELL-01', 'MANUAL-EN']);
  const fork = roots[0]!.children.find((n: Node) => n.name === 'FORK-200')!;
  assert.deepEqual(names(fork.children), ['CROWN-12', 'DROPOUT-F']);
  const hub = roots[1]!.children.find((n: Node) => n.name === 'HUB-F32')!;
  assert.deepEqual(names(hub.children), ['BEARING-6'], 'a level-3 part from the second page goes under its parent on it');
});

// ---- order status

test('order status: the timeline reads the status, the embed and invoice link use the order', () => {
  const snap = screen(orderStatus('104573', undefined, TODAY));
  const ctx = { screen: { lines: snap.lines, fields: snap.fields.map((f) => ({ id: f.id, row: f.row, col: f.col, length: f.length, value: f.value })) }, getField: () => undefined };
  const s = timeline.settings(component('demo-order-status', 'timeline').options);
  assert.equal(timeline.statusOf(ctx, s), 'SHP');
  assert.equal(timeline.progressOf(s, 'SHP').current, 2, 'Shipped is the third step');
  assert.equal(timeline.progressOf(s, 'HLD').stopped?.label, 'On hold');
  const url = (component('demo-order-status', 'embed').options as { url: string }).url;
  assert.deepEqual(embed.fillUrl(ctx, url), { url: `http://127.0.0.1:${DOCS_PORT}/orders/104573` });
  assert.equal(snap.lines[15]!.slice(21).trim(), trackingOf(findOrder('104573')!), 'a shipped order has a tracking number');
  assert.equal(screen(orderStatus('104578')).lines[15]!.slice(21).trim(), '', 'an unshipped one has none, so no barcode');
  assert.equal(snap.lines[17]!.slice(69, 75), '104573', 'the order number for the QR code');
});

test('order status shows every output display', () => {
  const kinds = def('demo-order-status').changes.flatMap((c) => (c.op === 'display' ? [c.display.type === 'link' ? `link:${c.display.to}` : c.display.type] : []));
  assert.deepEqual(new Set(kinds), new Set(['badge', 'date', 'number', 'yesno', 'progress', 'link:email', 'link:phone', 'link:url', 'barcode']));
  const view = customize(transform(screen(orderStatus(DEFAULT_ORDER))), def('demo-order-status'));
  assert.ok(view.items.some((i) => i.kind === 'image'), 'the image');
  assert.ok(view.items.some((i) => i.kind === 'label'), 'the labels');
});

// ---- delivery options

test('delivery options shows each new field widget, and checks what is typed', () => {
  const widgets = def('demo-delivery-options').changes.flatMap((c) => (c.op === 'widget' ? [c.widget.type] : []));
  assert.deepEqual(widgets, ['time', 'mask', 'lookup', 'toggle']);
  assert.equal(component('demo-delivery-options', 'star-rating').field, '11:22');
  const typed = (o: Record<string, string>) => checkDelivery(new Map(Object.entries(o)), DEFAULT_ORDER);
  assert.match(typed({}).message, /^Saved: after 14:00, phone 202-555-0117, UPS, notify Y, rating 4$/);
  assert.deepEqual(typed({ '7:22': '2560' }).error, '7:22');
  assert.deepEqual(typed({ '8:22': '555' }).error, '8:22');
  assert.deepEqual(typed({ '9:22': 'XYZ' }).error, '9:22');
  assert.deepEqual(typed({ '11:22': '6' }).error, '11:22');
  assert.match(typed({ '9:22': 'fdx', '11:22': '5' }).message, /FedEx, notify Y, rating 5/);
});

// ---- against the demo host

test('on the demo host: orders, option 8 to its status, F10 to delivery options and back', async (t) => {
  const host = new DemoHost();
  const port = await host.listen();
  const session = new Session({ host: '127.0.0.1', port, connectTimeoutMs: 5000 });
  t.after(() => { session.close(); host.server.close(); });
  await session.connect();
  await session.waitForInput(5000);
  const send = (aid: Parameters<Session['submit']>[0]['aid'], fields?: Record<string, string>) => {
    session.submit({ aid, ...(fields ? { fields } : {}) });
    return session.waitForInput(5000);
  };
  let snap = await send('Enter', { '6:53': 'DEMO' });
  assert.match(snap.lines.join('\n'), /14\. Order amounts \(charts\)/);

  snap = await send('Enter', { '20:7': '12' });
  assert.match(snap.lines[0]!, /Orders by Ship Date/);
  snap = await send('PageDown');
  assert.match(snap.lines[6]!, new RegExp(ORDERS[ORDERS_PAGE]!.number));
  assert.match(snap.lines[15]!, /Bottom/);
  snap = await send('Enter', { '8:3': '8' });
  assert.match(snap.lines[0]!, /Order Status/);
  assert.equal(snap.fields.find((f) => f.id === '4:22')!.value, ORDERS[ORDERS_PAGE + 1]!.number, 'the row\'s order');

  snap = await send('Enter', { '4:22': '104572' });
  assert.match(snap.lines[5]!, /Harbor Supply Co/);
  snap = await send('Enter', { '4:22': '999999' });
  assert.match(snap.lines[23]!, /Order 999999 not found/);

  snap = await send('F10');
  assert.match(snap.lines[0]!, /Delivery Options/);
  assert.match(snap.lines[4]!, /104572/);
  snap = await send('F4', { '9:22': 'X' });
  assert.equal(snap.lines[23]!.trim(), CARRIER_LIST);
  assert.deepEqual(snap.cursor, { row: 9, col: 22 });
  snap = await send('Enter', { '9:22': 'XYZ' });
  assert.match(snap.lines[23]!, /Carrier XYZ is not known/);
  assert.equal(snap.fields.find((f) => f.id === '9:22')!.value, 'XYZ', 'shown again as typed');
  snap = await send('Enter', { '7:22': '0930', '9:22': 'DHL', '10:22': 'N' });
  assert.match(snap.lines[23]!, /Saved: after 09:30, phone 415-555-0198, DHL, notify N, rating 4/);

  snap = await send('F12');
  assert.match(snap.lines[0]!, /Order Status/);
  snap = await send('F12');
  assert.match(snap.lines[0]!, /Orders by Ship Date/, 'back to the list it came from');
  assert.match(snap.lines[6]!, new RegExp(ORDERS[ORDERS_PAGE]!.number), 'on the same page');
});

test('on the demo host: the bill of materials pages, and the contacts map is option 18', async (t) => {
  const host = new DemoHost();
  const port = await host.listen();
  const session = new Session({ host: '127.0.0.1', port, connectTimeoutMs: 5000 });
  t.after(() => { session.close(); host.server.close(); });
  await session.connect();
  await session.waitForInput(5000);
  const send = (aid: Parameters<Session['submit']>[0]['aid'], fields?: Record<string, string>) => {
    session.submit({ aid, ...(fields ? { fields } : {}) });
    return session.waitForInput(5000);
  };
  await send('Enter', { '6:53': 'DEMO' });
  let snap = await send('Enter', { '20:7': '17' });
  assert.match(snap.lines[0]!, /Display Bill of Materials/);
  snap = await send('PageDown');
  snap = await send('PageDown');
  assert.match(snap.lines[17]!, /Bottom/);
  snap = await send('Enter', { '8:3': '5' });
  assert.match(snap.lines[23]!, new RegExp(`Display part ${BOM[2 * BOM_PAGE]![1]}`));
  await send('F3');
  snap = await send('Enter', { '20:7': '18' });
  assert.match(snap.lines[0]!, /Contacts by City/);
  snap = await send('PageDown');
  assert.match(snap.lines[0]!, /Contacts by City/, 'still the map view after paging');
});

test('the pin map finds each contact\'s city', () => {
  const list = wholeList('demo-contacts-map', [screen(contacts(0, undefined, 'map')), screen(contacts(1, undefined, 'map'))]);
  const s = pins.settings(component('demo-contacts-map', 'pin-map').options);
  assert.equal(list.records.length, CONTACTS.length);
  assert.equal(pins.addressOf(list, list.records[0], s), 'Chicago, USA');
});

// ---- the documents server

test('the documents pages: a packing list per order, an invoice, and not found', () => {
  const o = findOrder('104574')!;
  const packing = docsPage('/orders/104574');
  assert.equal(packing.status, 200);
  assert.match(packing.html, /Becker &#38; Sons/, 'text is escaped');
  assert.equal((packing.html.match(/<tr><td>/g) ?? []).length, linesOf(o).length);
  assert.match(docsPage('/invoices/INV-104574').html, /total \$640\.25/);
  assert.equal(docsPage('/orders/999999').status, 404);
  assert.equal(docsPage('/orders/104574/../../etc').status, 404);
  assert.equal(docsPage('/').status, 404);
});

test('the documents server answers on 127.0.0.1, and lets the page be framed', async (t) => {
  const started = await startDocsServer(0);
  assert.ok('server' in started);
  t.after(() => started.server.close());
  const res = await fetch(`http://127.0.0.1:${started.port}/orders/104577`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-frame-options'), null);
  assert.match(await res.text(), /Prairie Seed Co/);
  assert.equal((started.server.address() as { address: string }).address, '127.0.0.1');
  const taken = await startDocsServer(started.port);
  assert.deepEqual(taken, { error: `port ${started.port} is in use` });
});
