// Components reading a whole list (readList), going back to one of its rows
// (openRow), and reading every page of a region of the screen (readPages):
// the paging is Export's, so these check what each one finds and where it ends.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { FieldSnapshot, ScreenSnapshot } from '@veneer/terminal';
import { listData, tablesOf, visibleList } from '../src/custom/components.ts';
import { PageReader, RowSeeker, listOf, listSource, regionPage, regionSource, tablePage, type ReadStep, type TablePage, type TextPage } from '@veneer/view';
import { exportColumns } from '@veneer/view';
import type { ScreenView, TableItem } from '@veneer/view';

const optionField = (row: number) => ({ id: `${row}:3`, row, col: 3, length: 1, bypass: false, value: '' }) as FieldSnapshot;

/** A page of the jobs list: an option column, then job and status. */
function page(jobs: Array<[string, string]>, more: boolean, role?: 'danger'): TableItem {
  return {
    kind: 'table', row: 10, col: 2, width: 79, height: jobs.length + 1, headerRows: 1, more,
    columns: [{ col: 2, width: 4, header: 'Opt' }, { col: 6, width: 16, header: 'Job ' }, { col: 22, width: 8, header: 'Status' }],
    rows: jobs.map(([job, status], i) => ({
      row: 11 + i,
      ...(role && i === 0 ? { role } : {}),
      cells: [
        { col: 2, width: 4, text: '', role: 'normal', field: optionField(11 + i), options: [{ value: '2', label: 'Change' }, { value: '5', label: 'Display' }] },
        { col: 6, width: 16, text: job, role: 'normal' },
        { col: 22, width: 8, text: status, role: 'normal' },
      ],
    })),
  } as TableItem;
}
const view = (table: TableItem, hidden = false) =>
  (hidden ? { items: [], hiddenTables: [{ ...table, hidden: true }] } : { items: [table] }) as unknown as ScreenView;

const A = page([['QBATCH', 'ACTIVE'], ['  QINTER', 'MSGW']], true, 'danger');
const B = page([['QSPL', 'HELD']], true);
const C = page([['QHTTP', 'ACTIVE']], false);
const columns = exportColumns(A);

/** Drive a reader over pages [A, B, C], starting on `start`; returns the keys sent and the last step. */
function readAll(start: number) {
  const pages = [A, B, C];
  const reader = new PageReader(listSource(pages[start]!, 's1'), tablePage(pages[start]!, columns));
  let at = start;
  const sent: string[] = [];
  let step: ReadStep<TablePage> = reader.start();
  while ('send' in step) {
    sent.push(step.send);
    const next = step.send === 'PageDown' ? at + 1 : at - 1;
    const moved = next >= 0 && next < pages.length;
    if (moved) at = next;
    step = reader.onScreen(view(pages[at]!), 's1', !moved);
  }
  return { sent, step, at };
}

describe('reading a whole list', () => {
  test('every page, top to bottom, and back on the user\'s page', () => {
    const { sent, step, at } = readAll(1);
    assert.deepEqual(sent, ['PageUp', 'PageUp', 'PageDown', 'PageDown', 'PageUp']);
    assert.equal(at, 1, 'back on page 2');
    assert.ok('done' in step && step.pages);
    assert.equal(step.current, 1);
    assert.equal(step.complete, true);
    assert.deepEqual(step.pages.map((p) => p.rows), [[['QBATCH', 'ACTIVE'], ['QINTER', 'MSGW']], [['QSPL', 'HELD']], [['QHTTP', 'ACTIVE']]]);
  });

  test('as components get it: columns without the option column, rows in order, where each came from', () => {
    const { step } = readAll(0);
    assert.ok('done' in step && step.pages);
    const list = listData(A, step.pages, step.current!, step.complete!);
    assert.deepEqual(list.columns, ['Job', 'Status'], 'headings trimmed');
    assert.deepEqual(list.rows.map((r) => r[0]), ['QBATCH', 'QINTER', 'QSPL', 'QHTTP']);
    assert.deepEqual(list.records.map((r) => [r.page, r.index]), [[0, 0], [0, 1], [1, 0], [2, 0]]);
    assert.equal(list.records[1]!.raw[0], '  QINTER', 'untrimmed, for indenting');
    assert.equal(list.records[0]!.role, 'danger');
    assert.equal(list.records[2]!.option, '11:3');
    assert.deepEqual(list.options, [{ value: '2', label: 'Change' }, { value: '5', label: 'Display' }]);
    assert.deepEqual([list.pages, list.current, list.complete], [3, 0, true]);
  });

  test('a list on the screen has the key of its page, as read: a component knows which page is showing', () => {
    const { step } = readAll(1);
    assert.ok('done' in step && step.pages);
    const list = listData(A, step.pages, step.current!, step.complete!);
    assert.equal(tablesOf(view(B))[0]!.pageKey, list.pageKeys[1]);
    assert.equal(tablesOf(view(C, true))[0]!.pageKey, list.pageKeys[2], 'hidden too');
    assert.ok(!list.pageKeys.includes(tablesOf(view(page([['NEW', 'X']], false)))[0]!.pageKey));
    assert.equal(tablesOf(view(A))[0]!.records[1]!.raw[1], '  QINTER', 'untrimmed cells');
  });

  test('stopping at maxPages says the list is not complete', () => {
    const reader = new PageReader(listSource(A, 's1'), tablePage(A, columns), 2);
    reader.start();
    assert.deepEqual(reader.onScreen(view(A), 's1', true), { send: 'PageDown' }, 'the top');
    assert.deepEqual(reader.onScreen(view(B), 's1'), { send: 'PageUp' }, 'two pages: head back');
    const done = reader.onScreen(view(A), 's1');
    assert.ok('done' in done && done.pages?.length === 2 && done.complete === false);
  });

  test('a list a component took the place of is still found', () => {
    assert.equal(listOf(view(A, true))?.row, 10);
    assert.equal(listOf(view(A, true), { row: 10, col: 2 })?.col, 2);
    assert.equal(listOf(view(A), { row: 4, col: 2 }), undefined);
    const reader = new PageReader(listSource(A, 's1'), tablePage(A, columns));
    reader.start();
    assert.deepEqual(reader.onScreen(view(A, true), 's1', true), { send: 'PageDown' }, 'read while hidden');
  });

  test('in the designer: just the page showing', () => {
    const list = visibleList(view(B));
    assert.ok(list);
    assert.deepEqual(list.rows, [['QSPL', 'HELD']]);
    assert.deepEqual([list.pages, list.current, list.complete], [1, 0, false], 'More... below');
    assert.equal(visibleList({ items: [] } as unknown as ScreenView), undefined);
  });
});

describe('going to a row that was read', () => {
  const pages = [A, B, C].map((t) => tablePage(t, columns));
  const source = listSource(A, 's1');

  test('pages from the user\'s page to the row\'s, then types the option into it', () => {
    const seeker = new RowSeeker(source, pages, { page: 2, index: 0 }, '5');
    assert.deepEqual(seeker.start(view(A), 's1'), { send: 'PageDown' });
    assert.deepEqual(seeker.onScreen(view(B), 's1'), { send: 'PageDown' });
    assert.deepEqual(seeker.onScreen(view(C), 's1'), { done: true, fields: { '11:3': '5' } });
  });

  test('the row on the page showing: no keys first', () => {
    const seeker = new RowSeeker(source, pages, { page: 0, index: 1 }, '2');
    assert.deepEqual(seeker.start(view(A), 's1'), { done: true, fields: { '12:3': '2' } });
  });

  test('finds the page showing by its rows, so it works after the user paged', () => {
    const seeker = new RowSeeker(source, pages, { page: 0, index: 0 }, '5');
    assert.deepEqual(seeker.start(view(C), 's1'), { send: 'PageUp' });
    assert.deepEqual(seeker.onScreen(view(B), 's1'), { send: 'PageUp' });
    assert.deepEqual(seeker.onScreen(view(A), 's1'), { done: true, fields: { '11:3': '5' } });
  });

  test('a page that changed since it was read stops it', () => {
    const seeker = new RowSeeker(source, pages, { page: 2, index: 0 }, '5');
    seeker.start(view(A), 's1');
    const changed = seeker.onScreen(view(page([['QSPL', 'RELEASED']], true)), 's1');
    assert.ok('done' in changed && changed.error && !changed.fields);
    const unknown = new RowSeeker(source, pages, { page: 2, index: 0 }, '5').start(view(page([['NEW', 'X']], true)), 's1');
    assert.ok('done' in unknown && unknown.error);
    const refused = new RowSeeker(source, pages, { page: 2, index: 0 }, '5');
    refused.start(view(A), 's1');
    assert.ok('error' in refused.onScreen(view(A), 's1', true));
  });
});

describe('reading every page of a region', () => {
  const screen = (body: string[], footer: string): ScreenView => {
    const lines = ['Display Spooled File', 'File  . . . :   QSYSPRT', ...body, footer, 'F3=Exit'];
    return { items: [], snapshot: { lines, rows: lines.length } as unknown as ScreenSnapshot } as unknown as ScreenView;
  };
  const one = screen(['line 1', 'line 2'], '                                More...');
  const two = screen(['line 3', '      '], '                                 Bottom');

  test('the region\'s lines, untrimmed; "Bottom" ends it', () => {
    assert.deepEqual(regionPage(one, 3, 4), { lines: ['line 1', 'line 2'], more: true });
    assert.deepEqual(regionPage(two, 3, 4), { lines: ['line 3', '      '], more: false });
    const reader = new PageReader(regionSource('sp', 3, 4), regionPage(one, 3, 4));
    assert.deepEqual(reader.start(), { send: 'PageUp' });
    assert.deepEqual(reader.onScreen(one, 'sp', true), { send: 'PageDown' }, 'already at the top');
    assert.deepEqual(reader.onScreen(two, 'sp'), { send: 'PageUp' }, 'Bottom: head back');
    const done = reader.onScreen(one, 'sp') as ReadStep<TextPage>;
    assert.ok('done' in done && done.pages);
    assert.deepEqual(done.pages.map((p) => p.lines), [['line 1', 'line 2'], ['line 3', '      ']]);
  });

  test('ISPF and SDSF: "BOTTOM OF DATA" ends it too', () => {
    const sdsf = screen([' ******************************** BOTTOM OF DATA ********************************'], '');
    assert.equal(regionPage(sdsf, 3, 3).more, false);
    assert.equal(regionPage(screen(['Bottom line of the report: totals'], ''), 3, 3).more, true, 'the word alone in text is not the marker');
  });
});
