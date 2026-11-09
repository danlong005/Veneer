// Turning a 5250 list (a detected subfile table) into CSV or an Excel workbook.

import type { TableItem } from '../transform/types.ts';
import { zip } from './zip.ts';

export interface Sheet {
  header: string[];
  rows: string[][];
}

/**
 * The columns worth exporting: every column except ones that hold only input
 * fields (the option column, where users type 2=Change and so on).
 */
export function exportColumns(table: TableItem): number[] {
  return table.columns.flatMap((_, k) => {
    const cells = table.rows.map((r) => r.cells[k]);
    const inputOnly = cells.length > 0 && cells.every((c) => c?.field && !c.field.bypass);
    return inputOnly ? [] : [k];
  });
}

/** One page of a table as rows of text, in the given columns. */
export function pageRows(table: TableItem, columns: number[]): string[][] {
  return table.rows.map((r) => columns.map((k) => {
    const c = r.cells[k];
    return (c?.field ? c.field.value : c?.text ?? '').trim();
  }));
}

export function headerOf(table: TableItem, columns: number[]): string[] {
  return columns.map((k) => table.columns[k]?.header ?? '');
}

// ---- values ------------------------------------------------------------------

/**
 * A screen value as a number, if it is one: "1,234.50", "12.5-" (trailing
 * minus, as the IBM i shows negatives), ".4". Codes with leading zeros, such as
 * "00123", stay text so the zeros survive.
 */
export function numberOf(text: string): number | null {
  let t = text.trim();
  if (t === '') return null;
  let negative = false;
  if (t.endsWith('-')) { negative = true; t = t.slice(0, -1).trimEnd(); }
  if (t.startsWith('-')) { if (negative) return null; negative = true; t = t.slice(1); }
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  if (!/^(0|[1-9]\d*)?(\.\d+)?$/.test(t) || t === '' || t === '.') return null;
  // Too many digits for a double to hold exactly: keep the text.
  if (t.replace('.', '').length > 15) return null;
  const n = Number(t);
  return negative ? -n : n;
}

// ---- CSV -----------------------------------------------------------------------

export function toCsv(sheet: Sheet): string {
  const field = (v: string) => (/[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  // The byte-order mark makes Excel read the file as UTF-8.
  return '﻿' + [sheet.header, ...sheet.rows].map((r) => r.map(field).join(',')).join('\r\n') + '\r\n';
}

// ---- Excel (.xlsx) -------------------------------------------------------------

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // Characters XML 1.0 can't hold.
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function columnName(k: number): string {
  let n = k + 1;
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** A one-sheet workbook. Numbers are numbers; everything else is text. Header is bold and frozen. */
export function toXlsx(sheet: Sheet, sheetName = 'List'): Uint8Array {
  const cell = (v: string, ref: string, header: boolean) => {
    if (header) return `<c r="${ref}" t="inlineStr" s="1"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    const n = numberOf(v);
    if (n !== null) return `<c r="${ref}"><v>${n}</v></c>`;
    return v === '' ? '' : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  };
  const rows = [sheet.header, ...sheet.rows].map((r, i) =>
    `<row r="${i + 1}">${r.map((v, k) => cell(v, `${columnName(k)}${i + 1}`, i === 0)).join('')}</row>`).join('');
  const widths = sheet.header.map((h, k) => {
    const longest = Math.max(h.length, ...sheet.rows.map((r) => (r[k] ?? '').length));
    return `<col min="${k + 1}" max="${k + 1}" width="${Math.min(60, Math.max(6, longest + 2))}" customWidth="1"/>`;
  }).join('');
  const name = xml(sheetName.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'List');

  return zip({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${rows}</sheetData></worksheet>`,
  });
}
