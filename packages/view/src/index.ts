// @veneer/view: how Veneer reads a screen. The transform rules turn a screen
// into a view (titles, lists, fields, function keys, messages); customize()
// applies a screen definition to it; the exporter reads a list across its
// pages. The browser draws the view; the server reads it for the macro API.

export * from './transform/index.ts';
export { customize, heightOf, homeOf, isBox, itemAt, type CustomizeOptions } from './transform/customize.ts';
export { EMPTY_CONSOLE, MAX_HISTORY, nextConsole, pageLines, type ConsoleLog } from './transform/console.ts';
export { asLineMode, lineModeInput } from './transform/lineMode.ts';
export { legendTokens, rowLine, stripLeaders, type Token } from './transform/text.ts';
export { aidForKey } from './transform/rules/functionKeys.ts';
export * from './export/exporter.ts';
export * from './export/sheet.ts';
export { crc32, zip } from './export/zip.ts';
export * from './fieldRules.ts';
