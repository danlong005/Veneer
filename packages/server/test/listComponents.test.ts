// The ready-made components that show a list (dev/components): the shared
// lib/lists.js (numbers, dates, the page or the whole list), and what each of
// the whole-list table, totals, chart, board, calendar, tree and pin map
// makes of a list. Drawing is checked in a browser; this is their logic.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as lists from '../dev/components/lib/lists.js';
import * as table from '../dev/components/list-table.js';
import * as totals from '../dev/components/totals.js';
import * as chart from '../dev/components/bar-chart.js';
import * as board from '../dev/components/board.js';
import * as calendar from '../dev/components/calendar.js';
import * as tree from '../dev/components/tree.js';
import * as pins from '../dev/components/pin-map.js';

// ---- lists, as readList() gives them

interface Rec { cells: string[]; raw: string[]; role: string | null; option: string | null; page: number; index: number }
const record = (cells: string[], page = 0, index = 0, extra: Partial<Rec> = {}): Rec => ({ cells, raw: cells, role: null, option: `${11 + index}:3`, page, index, ...extra });

const ORDERS = {
  row: 10, col: 2,
  columns: ['Order', 'Customer', 'Status', 'Amount', 'Ship date'],
  options: [{ value: '2', label: 'Change' }, { value: '5', label: 'Display' }],
  records: [
    record(['1001', 'Lakeside Hardware', 'OPEN', '1,200.50', '11/03/2026'], 0, 0),
    record(['1002', 'Harbor Supply', 'HELD', '75.00', '11/05/2026'], 0, 1),
    record(['1003', 'Capitol Office', 'OPEN', '310.25-', '10/28/2026'], 1, 0),
    record(['1004', 'Item 10 Co', 'SHIPPED', '', '11/05/2026'], 1, 1),
    record(['1005', 'Item 2 Co', 'OPEN', '42', 'never'], 2, 0),
  ],
  pages: 3, current: 0, complete: true, pageKeys: ['a', 'b', 'c'],
};

describe('lib: numbers and dates as hosts show them', () => {
  test('numbers with separators, signs, currency and percent; decimals as shown', () => {
    assert.deepEqual(lists.readNumber('1,234.50'), { value: 1234.5, decimals: 2 });
    assert.deepEqual(lists.readNumber('12.50-'), { value: -12.5, decimals: 2 });
    assert.deepEqual(lists.readNumber('1.234,5'), { value: 1234.5, decimals: 1 });
    assert.deepEqual(lists.readNumber('(12.00)'), { value: -12, decimals: 2 });
    assert.equal(lists.parseNumber('$1,200'), 1200);
    assert.equal(lists.parseNumber('45%'), 45);
    assert.equal(lists.parseNumber('12.5CR'), -12.5);
    assert.equal(lists.parseNumber('1,234'), 1234, 'three digits after one comma: thousands');
    assert.equal(lists.parseNumber('ACTIVE'), undefined);
    assert.equal(lists.parseNumber(''), undefined);
  });

  test('dates by format, including IBM\'s century digit; without one, ISO and US dates', () => {
    assert.deepEqual(lists.parseDate('1261105', 'CYYMMDD'), { y: 2026, m: 11, d: 5 });
    assert.deepEqual(lists.parseDate('0991231', 'CYYMMDD'), { y: 1999, m: 12, d: 31 });
    assert.deepEqual(lists.parseDate('05.11.2026', 'DD.MM.YYYY'), { y: 2026, m: 11, d: 5 });
    assert.deepEqual(lists.parseDate('261105', 'yymmdd'), { y: 2026, m: 11, d: 5 }, 'any case');
    assert.deepEqual(lists.parseDate('2026-11-05'), { y: 2026, m: 11, d: 5 });
    assert.deepEqual(lists.parseDate('11/5/26'), { y: 2026, m: 11, d: 5 });
    assert.deepEqual(lists.parseDate('1/2/1975'), { y: 1975, m: 1, d: 2 });
  });

  test('not dates: wrong separators, impossible days, blanks', () => {
    assert.equal(lists.parseDate('11-05-26', 'MM/DD/YY'), undefined);
    assert.equal(lists.parseDate('02/30/2026'), undefined);
    assert.equal(lists.parseDate('13/01/2026'), undefined);
    assert.equal(lists.parseDate(''), undefined);
    assert.equal(lists.parseDate('0000000', 'CYYMMDD'), undefined);
    assert.equal(lists.isoDate({ y: 2026, m: 1, d: 9 }), '2026-01-09');
  });
});

describe('lib: the page showing, as readList() gives a list', () => {
  const screenTable = {
    row: 6, col: 2, columns: ['Opt', 'Name', 'City'], rows: [], more: true, pageKey: 'k1',
    options: [{ value: '5', label: 'Display' }],
    records: [{ row: 7, cells: ['', 'Maria', 'Chicago'], raw: ['', '  Maria', 'Chicago'], fields: ['7:3', null, null], option: '7:3', role: 'danger', roles: ['normal', 'normal', 'warning'] }],
  };

  test('the option column left out; records keep their option field', () => {
    const list = lists.pageList(screenTable);
    assert.deepEqual(list.columns, ['Name', 'City']);
    assert.deepEqual(list.records[0], { cells: ['Maria', 'Chicago'], raw: ['  Maria', 'Chicago'], role: 'danger', roles: ['normal', 'warning'], option: '7:3', page: 0, index: 0 });
    assert.deepEqual([list.complete, list.more, list.pageKeys], [false, true, ['k1']]);
  });

  test('the first list with the headings named', () => {
    const other = { ...screenTable, columns: ['Opt', 'Item'] };
    assert.equal(lists.pickTable([other, screenTable], ['city']), screenTable);
    assert.equal(lists.pickTable([other, screenTable], []), other);
    assert.equal(lists.pickTable([other], ['City']), undefined);
  });
});

describe('lib: listFeed', () => {
  const screenTable = (key: string) => ({
    row: 10, col: 2, columns: ['Opt', 'Order'], options: [], more: true, pageKey: key,
    records: [{ row: 11, cells: ['', '1001'], fields: ['11:3', null], option: '11:3', role: null, roles: [] }],
  });
  function ctxWith(key: string, read: () => Promise<unknown>, extra = {}) {
    const calls = { reads: 0, opened: [] as unknown[], pressed: [] as unknown[] };
    const ctx = {
      tables: [screenTable(key)], design: false,
      readList: (o: unknown) => { calls.reads++; calls.opened.push(['read', o]); return read(); },
      openRow: (r: unknown, v: string) => { calls.opened.push(['open', v]); return Promise.resolve(); },
      press: (aid: string, fields: unknown) => { calls.pressed.push([aid, fields]); },
      ...extra,
    };
    return { ctx, calls };
  }
  const settle = () => new Promise((r) => setImmediate(r));

  test('"all": reads the list once at that place; screens while reading are the reader\'s', async () => {
    const states: Array<{ loading: boolean }> = [];
    let finish!: (v: unknown) => void;
    const { ctx, calls } = ctxWith('p1', () => new Promise((r) => { finish = r; }));
    const feed = lists.listFeed(ctx, { scope: 'all', maxPages: 20, onChange: (s: { loading: boolean }) => states.push({ ...s }) });
    assert.equal(calls.reads, 1);
    assert.deepEqual(calls.opened[0], ['read', { at: { row: 10, col: 2 }, maxPages: 20 }]);
    feed.update({ ...ctx, tables: [screenTable('p2')] });
    assert.equal(calls.reads, 1, 'paging while it reads');
    finish({ ...ORDERS, pageKeys: ['p1', 'p2'] });
    await settle();
    assert.equal(feed.state.list.records.length, 5);
    assert.deepEqual(states.map((s) => s.loading), [true, false]);
    feed.update({ ...ctx, tables: [screenTable('p2')] });
    assert.equal(calls.reads, 1, 'the user paged to a page that was read');
    feed.update({ ...ctx, tables: [screenTable('new')] });
    assert.equal(calls.reads, 2, 'a page that wasn\'t read: the list changed');
  });

  test('a failed read is tried again on a new screen, not on the same one, and at most twice in a row', async () => {
    const { ctx, calls } = ctxWith('p1', () => Promise.reject(new Error('Press Enter or clear your changes first.')), { screen: { id: 's1' } });
    const feed = lists.listFeed(ctx, { scope: 'all', onChange: () => {} });
    await settle();
    assert.equal(feed.state.error, 'Press Enter or clear your changes first.');
    feed.update({ ...ctx });
    assert.equal(calls.reads, 1, 'typing: the same screen');
    feed.update({ ...ctx, screen: { id: 's2' } });
    await settle();
    assert.equal(calls.reads, 2, 'the user pressed Enter: a new screen');
    feed.update({ ...ctx, screen: { id: 's3' } });
    await settle();
    assert.equal(calls.reads, 2, 'two failures in a row: it waits');
    feed.refresh();
    assert.equal(calls.reads, 3, 'Refresh always tries');
  });

  test('"page" and the designer: the page showing, no reading', () => {
    const { ctx, calls } = ctxWith('p1', () => Promise.resolve(ORDERS));
    const page = lists.listFeed(ctx, { scope: 'page', onChange: () => {} });
    assert.deepEqual(page.state.list.rows, [['1001']]);
    const design = lists.listFeed({ ...ctx, design: true }, { scope: 'all', onChange: () => {} });
    assert.equal(design.state.list.preview, true);
    assert.equal(calls.reads, 0);
  });

  test('run: on the page showing it types the option and presses Enter; from the whole list it pages to the row', async () => {
    const { ctx, calls } = ctxWith('p1', () => Promise.resolve(ORDERS));
    const page = lists.listFeed(ctx, { scope: 'page', onChange: () => {} });
    assert.equal(page.run(page.state.list.records[0], '5'), true);
    assert.deepEqual(calls.pressed, [['Enter', { '11:3': '5' }]]);
    const all = lists.listFeed(ctx, { scope: 'all', onChange: () => {} });
    await settle();
    all.run(ORDERS.records[3], '2');
    assert.deepEqual(calls.opened.at(-1), ['open', '2']);
    assert.equal(all.run(ORDERS.records[3], ''), false);
  });

  test('no list on the screen says so', () => {
    const states: Array<{ error: string }> = [];
    lists.listFeed({ tables: [], design: false }, { scope: 'all', headings: ['Order'], onChange: (s: { error: string }) => states.push(s) });
    assert.match(states[0]!.error, /No list on this screen has the columns “Order”/);
  });
});

describe('whole-list table', () => {
  test('options and their mistakes', () => {
    const s = table.settings({ columns: ['Order', 'Status'], filters: ['Status'], sort: '-Amount', actions: ['5'], default: 5 });
    assert.deepEqual([s.columns, s.filters, s.sort, s.actions, s.default, s.list, s.maxPages, s.error], [['Order', 'Status'], ['Status'], { column: 'Amount', descending: true }, ['5'], '5', 'all', 100, '']);
    assert.match(table.settings({ columns: 'Order' }).error, /"columns" must be a list/);
    assert.match(table.settings({ list: 'some' }).error, /"list" must be "all" or "page"/);
    assert.match(table.settings({ maxPages: 'lots' }).error, /maxPages/);
    assert.equal(table.settings({ maxPages: 9999 }).maxPages, 500);
  });

  test('how columns sort: numbers, dates, else text with numbers in order', () => {
    assert.equal(table.sortKind(ORDERS.records, 3), 'number', 'blanks don\'t count');
    assert.equal(table.sortKind(ORDERS.records, 2), 'text');
    assert.equal(table.sortKind(ORDERS.records.slice(0, 4), 4), 'date');
    assert.equal(table.sortKind(ORDERS.records, 4), 'text', '"never" isn\'t a date');
  });

  test('sorting: numbers by value, blanks last both ways, ties keep the list\'s order', () => {
    const order = (rs: Rec[]) => rs.map((r) => r.cells[0]);
    assert.deepEqual(order(table.sortRecords(ORDERS.records, 3)), ['1003', '1005', '1002', '1001', '1004']);
    assert.deepEqual(order(table.sortRecords(ORDERS.records, 3, true)), ['1001', '1002', '1005', '1003', '1004']);
    assert.deepEqual(order(table.sortRecords(ORDERS.records.slice(0, 4), 4)), ['1003', '1001', '1002', '1004'], 'by date, not as text');
    assert.deepEqual(order(table.sortRecords(ORDERS.records, 1)).slice(2, 4), ['1005', '1004'], '"Item 2" before "Item 10"');
  });

  test('search matches every word, anywhere in the row, ignoring case; filters match exactly', () => {
    const ids = (rs: Rec[]) => rs.map((r) => r.cells[0]);
    assert.deepEqual(ids(table.matching(ORDERS.records, { search: 'OPEN co' })), ['1005'], '"co" in "Item 2 Co"');
    assert.deepEqual(ids(table.matching(ORDERS.records, { search: 'open  2026 -' })), ['1003'], 'the minus sign of 310.25-');
    assert.deepEqual(ids(table.matching(ORDERS.records, { filters: { 2: 'HELD' } })), ['1002']);
    assert.deepEqual(ids(table.matching(ORDERS.records, { search: 'lakeside', columns: [0, 2] })), [], 'only the columns shown');
    assert.deepEqual(table.filterValues(ORDERS.records, 2), ['HELD', 'OPEN', 'SHIPPED']);
  });

  test('the columns shown, by heading', () => {
    assert.deepEqual(table.shownColumns(ORDERS, table.settings({ columns: ['status', 'Fax', 'Order'] })), [2, 0]);
    assert.deepEqual(table.shownColumns(ORDERS, table.settings({})), [0, 1, 2, 3, 4]);
  });
});

describe('totals', () => {
  const list = ORDERS;
  test('totals as strings or objects, and what\'s wrong with them', () => {
    assert.deepEqual(totals.settings({}).totals.map((t: { of: string }) => t.of), ['count']);
    const [sum] = totals.settings({ totals: ['sum:Amount'] }).totals;
    assert.deepEqual([sum.of, sum.column], ['sum', 'Amount']);
    assert.match(totals.settings({ totals: ['median:Amount'] }).error, /"median" isn't a total/);
    assert.match(totals.settings({ totals: ['sum'] }).error, /sum needs a column/);
    assert.match(totals.settings({ totals: [{ of: 'sum', column: 'Amount', currency: 'dollars' }] }).error, /3-letter code/);
    assert.match(totals.settings({ totals: [] }).error, /must be a list/);
    assert.equal(totals.settings({}).list, 'page', 'the page by default');
  });

  test('count, sum, average, min and max, with the decimals the column shows', () => {
    const t = (x: unknown) => totals.compute(list, totals.parseTotal(x), 'en-US');
    assert.deepEqual(t('count'), { value: 5, text: '5', label: 'rows' });
    assert.equal(t('sum:Amount').text, '1,007.25', '1,200.50 + 75.00 - 310.25 + 42');
    assert.equal(t('average:Amount').text, '251.81');
    assert.equal(t('min:Amount').text, '-310.25');
    assert.equal(t({ of: 'max', column: 'amount', label: 'biggest' }).label, 'biggest');
    assert.equal(t({ of: 'sum', column: 'Amount', currency: 'USD' }).text, '$1,007.25');
    assert.equal(t({ of: 'sum', column: 'Amount', decimals: 0 }).text, '1,007');
  });

  test('min and max of a date column; where counts only some rows', () => {
    const dates = { ...list, records: list.records.slice(0, 4) };
    assert.equal(totals.compute(dates, totals.parseTotal('max:Ship date')).text, '11/05/2026');
    assert.equal(totals.compute(dates, totals.parseTotal('min:Ship date')).text, '10/28/2026');
    const open = totals.compute(list, totals.parseTotal({ of: 'count', where: { status: 'open' }, label: 'open' }), 'en-US');
    assert.deepEqual([open.value, open.label], [3, 'open']);
    assert.match(totals.compute(list, totals.parseTotal('sum:Fax')).error, /No “Fax” column/);
    assert.equal(totals.compute(list, totals.parseTotal('sum:Status')).text, '—', 'no numbers');
  });
});

describe('chart', () => {
  test('types, columns and their mistakes', () => {
    assert.deepEqual([chart.settings({ column: 'Amount' }).type, chart.settings({ column: 'Amount' }).error], ['bar', '']);
    assert.deepEqual(chart.settings({ column: ['Open', 'Shipped'], type: 'stacked' }).columns, ['Open', 'Shipped']);
    assert.match(chart.settings({ column: ['A', 'B'], type: 'pie' }).error, /A pie charts one column/);
    assert.match(chart.settings({ column: 'A', type: 'radar' }).error, /"type" must be one of/);
    assert.match(chart.settings({}).error, /Set the "column" option/);
  });

  test('a point per row with a number; the label column names it', () => {
    const d = chart.chartData(ORDERS, chart.settings({ column: 'Amount', label: 'Customer' }));
    assert.deepEqual(d.points.map((p: { name: string }) => p.name), ['Lakeside Hardware', 'Harbor Supply', 'Capitol Office', 'Item 2 Co']);
    assert.deepEqual(d.points[2].values, [-310.25]);
    assert.match(chart.chartData(ORDERS, chart.settings({ column: 'Fax' })).error, /No “Fax” column/);
  });

  test('ticks are round and include zero', () => {
    assert.deepEqual(chart.niceTicks(0, 1200.5), [0, 500, 1000, 1500]);
    assert.deepEqual(chart.niceTicks(-310, 1200), [-500, 0, 500, 1000, 1500]);
    assert.deepEqual(chart.niceTicks(3, 7), [0, 2, 4, 6, 8]);
  });

  test('stacked bars skip values below zero; a pie folds small slices into Other', () => {
    const st = chart.stacks([{ values: [2, null, 3] }, { values: [-1, 4, 1] }]);
    assert.deepEqual(st.stacks, [[[0, 2], null, [2, 5]], [null, [0, 4], [4, 5]]]);
    assert.equal(st.top, 5);
    const points = Array.from({ length: 10 }, (_, i) => ({ name: `P${i}`, values: [i + 1], texts: [String(i + 1)] }));
    const s = chart.slices(points);
    assert.equal(s.length, chart.MAX_SLICES);
    assert.equal(s.at(-1).name, 'Other');
    assert.equal(s.at(-1).value, 1 + 2 + 3 + 4);
    assert.ok(Math.abs(s.at(-1).end - Math.PI * 2) < 1e-9, 'the slices go all the way round');
    assert.deepEqual(chart.slices([{ name: 'x', values: [-3], texts: ['-3'] }]), []);
  });

  test('slice paths: a wedge, a ring segment, and a whole circle in two halves', () => {
    assert.equal(chart.arcPath(50, 50, 40, 0, 0, Math.PI / 2), 'M50,50 L50,10 A40,40 0 0 1 90,50 Z');
    assert.match(chart.arcPath(50, 50, 40, 24, 0, Math.PI / 2), /^M50,10 A40,40 0 0 1 90,50 L74,50 A24,24 0 0 0 50,26 Z$/);
    assert.equal(chart.arcPath(50, 50, 40, 0, 0, Math.PI * 2).match(/A40/g)!.length, 2);
  });
});

describe('board', () => {
  test('options: the column to group by is required', () => {
    assert.match(board.settings({}).error, /Set the "column" option/);
    assert.match(board.settings({ column: 'Status', lanes: 'OPEN' }).error, /"lanes" must be a list/);
    assert.deepEqual(board.settings({ column: 'Status', lanes: ['OPEN', { value: 'HLD', label: 'Held' }] }).lanes, [{ value: 'OPEN', label: 'OPEN' }, { value: 'HLD', label: 'Held' }]);
  });

  test('a lane per value in the order they appear', () => {
    const { lanes } = board.lanesOf(ORDERS, board.settings({ column: 'Status', title: 'Customer' }));
    assert.deepEqual(lanes.map((l: { label: string; cards: unknown[] }) => [l.label, l.cards.length]), [['OPEN', 3], ['HELD', 1], ['SHIPPED', 1]]);
    assert.equal(lanes[0].cards[0].title, 'Lakeside Hardware');
  });

  test('named lanes in their order, even empty; the rest in Other', () => {
    const { lanes } = board.lanesOf(ORDERS, board.settings({ column: 'status', lanes: ['held', 'OPEN', 'CANCELLED'] }));
    assert.deepEqual(lanes.map((l: { label: string; cards: unknown[] }) => [l.label, l.cards.length]), [['held', 1], ['OPEN', 3], ['CANCELLED', 0], ['Other', 1]]);
    assert.match(board.lanesOf(ORDERS, board.settings({ column: 'Region' })).error, /No “Region” column/);
  });
});

describe('calendar', () => {
  test('options', () => {
    assert.match(calendar.settings({}).error, /Set the "date" option/);
    assert.match(calendar.settings({ date: 'Ship date', view: 'year' }).error, /"view"/);
    assert.match(calendar.settings({ date: 'Ship date', format: 'MM/YY' }).error, /needs Y, M and D/);
    assert.match(calendar.settings({ date: 'Ship date', format: 'dd mmm yyyy!' }).error, /isn't a date format/);
    assert.equal(calendar.settings({ date: 'Ship date', format: 'MM/DD/YYYY' }).error, '');
  });

  test('a row per date it can read, named by the title column; the others are counted', () => {
    const { events, unread } = calendar.eventsOf(ORDERS, calendar.settings({ date: 'Ship date', title: 'Customer' }));
    assert.deepEqual(events.map((e: { iso: string; title: string }) => [e.iso, e.title]), [
      ['2026-11-03', 'Lakeside Hardware'], ['2026-11-05', 'Harbor Supply'], ['2026-10-28', 'Capitol Office'], ['2026-11-05', 'Item 10 Co'],
    ]);
    assert.equal(unread, 1, '"never"');
    const first = calendar.eventsOf(ORDERS, calendar.settings({ date: 'Ship date' })).events[0];
    assert.equal(first.title, '1001', 'default: the first other column');
  });

  test('a month\'s weeks from the week of the 1st; weeks from Sunday or Monday', () => {
    const weeks = calendar.monthGrid('2026-11-17');
    assert.equal(weeks[0][0].iso, '2026-11-01', 'November 2026 starts on a Sunday');
    assert.equal(weeks.length, 5);
    assert.equal(weeks.at(-1).at(-1).iso, '2026-12-05');
    assert.equal(weeks.at(-1).at(-1).inMonth, false);
    assert.equal(calendar.monthGrid('2026-11-17', 1)[0][0].iso, '2026-10-26', 'from Monday');
    assert.equal(calendar.weekOf('2026-11-05', 1), '2026-11-02');
  });

  test('moving by months keeps the day when it can', () => {
    assert.equal(calendar.addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(calendar.addMonths('2026-11-05', -11), '2025-12-05');
    assert.equal(calendar.addDays('2026-12-31', 1), '2027-01-01');
  });

  test('it opens on today\'s month if anything is in it, else the first date', () => {
    const events = [{ iso: '2026-12-02' }, { iso: '2026-09-15' }];
    assert.equal(calendar.openingDay(events, '2026-11-05'), '2026-09-15');
    assert.equal(calendar.openingDay([...events, { iso: '2026-11-30' }], '2026-11-05'), '2026-11-05');
    assert.equal(calendar.openingDay([], '2026-11-05'), '2026-11-05');
  });
});

describe('tree', () => {
  test('levels from a level column: numbers, dots and outline numbers', () => {
    assert.deepEqual(['1', '02', '.2', '..3', '...', '1.2.3', '1.2.', 'x'].map(tree.levelOf), [1, 2, 2, 3, 4, 3, 2, 0]);
  });

  test('levels from indenting, whatever the step', () => {
    assert.deepEqual(tree.indentLevels(['BIKE', '   FRAME', '      TUBE', '   WHEEL', '']), [1, 2, 3, 2, 1]);
    assert.deepEqual(tree.indentLevels([' A', '   B']), [1, 2], 'from the least indented');
  });

  test('each row under the nearest row above with a lower level', () => {
    const bom = {
      columns: ['Part', 'Lvl', 'Qty'],
      records: [['BIKE', '1', '1'], ['FRAME', '2', '1'], ['TUBE', '3', '4'], ['WHEEL', '2', '2'], ['SPOKE', '4', '36'], ['BELL', '1', '1']]
        .map((cells, i) => record(cells, 0, i)),
    };
    const { nodes } = tree.buildTree(bom, tree.settings({ column: 'Part', level: 'Lvl', fields: ['Qty'] }));
    const shape = (ns: Array<{ name: string; depth: number; children: unknown[] }>): unknown => ns.map((n) => [n.name, n.depth, shape(n.children as never)]);
    assert.deepEqual(shape(nodes), [
      ['BIKE', 1, [['FRAME', 2, [['TUBE', 3, []]]], ['WHEEL', 2, [['SPOKE', 3, []]]]]],
      ['BELL', 1, []],
    ], 'a jump from 2 to 4 still hangs under WHEEL');
    assert.deepEqual(nodes[0].children[1].children[0].facts, [{ label: 'Qty', value: '36' }]);
    assert.deepEqual(tree.walk(nodes).map((n: { name: string }) => n.name), ['BIKE', 'FRAME', 'TUBE', 'WHEEL', 'SPOKE', 'BELL']);
  });

  test('from indenting when there\'s no level column', () => {
    const folders = { columns: ['Name'], records: ['/home', '  /home/ann', '  /home/bob', '/tmp'].map((t, i) => record([t.trim()], 0, i, { raw: [t] })) };
    const { nodes } = tree.buildTree(folders, tree.settings({}));
    assert.deepEqual(nodes.map((n: { name: string; children: unknown[] }) => [n.name, n.children.length]), [['/home', 2], ['/tmp', 0]]);
    assert.match(tree.buildTree(folders, tree.settings({ level: 'Depth' })).error, /No “Depth” column/);
  });
});

describe('pin map', () => {
  test('options', () => {
    assert.match(pins.settings({}).error, /Set "address"/);
    assert.match(pins.settings({ address: ['City'], tiles: 'http://tiles.example.com/{z}/{x}/{y}.png' }).error, /"tiles" must be an https/);
    assert.match(pins.settings({ address: ['City'], tiles: 'https://tiles.example.com/{z}.png' }).error, /\{z\}, \{x\} and \{y\}/);
    assert.match(pins.settings({ address: ['City'], geocoder: 'ftp://x' }).error, /geocoder must be an https/);
    assert.equal(pins.settings({ address: ['City'], maxPins: 900 }).maxPins, 500);
  });

  const people = { columns: ['Name', 'Street', 'City', 'State'], records: [record(['Ann', '1 Main St', 'Springfield', 'IL']), record(['Bob', '', '', ''])] };
  test('each row\'s address from its columns or a template; blank addresses are none', () => {
    const cols = pins.settings({ address: ['Street', 'city', 'State'], suffix: 'USA' });
    assert.equal(pins.addressOf(people, people.records[0], cols), '1 Main St, Springfield, IL, USA');
    assert.equal(pins.addressOf(people, people.records[1], cols), '');
    const tpl = pins.settings({ address: '{Street}, {City} {State}' });
    assert.equal(pins.addressOf(people, people.records[0], tpl), '1 Main St, Springfield IL');
    assert.equal(pins.addressOf(people, people.records[1], tpl), '');
    assert.deepEqual(pins.addressHeadings(tpl), ['Street', 'City', 'State']);
  });

  test('Web Mercator: the map\'s middle, corners and tiles', () => {
    assert.deepEqual(pins.project(0, 0, 0), { x: 128, y: 128 });
    assert.equal(Math.round(pins.project(85.05, -180, 1).y), 0);
    const view = pins.fitView([{ lat: 40.71, lon: -74.0 }, { lat: 41.88, lon: -87.63 }], 400, 250);
    assert.equal(view.z, 5, 'New York and Chicago fit at zoom 5');
    assert.equal(pins.fitView([{ lat: 1, lon: 1 }], 400, 250).z, 14, 'one pin: streets');
    const tiles = pins.tilesFor({ z: 1, cx: 256, cy: 256 }, 512, 512, 'https://t/{z}/{x}/{y}.png');
    assert.deepEqual(tiles.map((t: { url: string }) => t.url), ['https://t/1/0/0.png', 'https://t/1/1/0.png', 'https://t/1/0/1.png', 'https://t/1/1/1.png'], 'the whole world at zoom 1, no more');
    assert.deepEqual([tiles[0].left, tiles[0].top], [0, 0]);
    const wrapped = pins.tilesFor({ z: 1, cx: 0, cy: 256 }, 256, 256, 'https://t/{z}/{x}/{y}.png');
    assert.ok(wrapped.some((t: { x: number }) => t.x === 1), 'west of 180° wraps round');
  });
});
