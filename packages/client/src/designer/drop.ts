// The designer's palette (#55): what can be dropped where on the screen, and
// the change a drop makes. Kept apart from the panel and the canvas so the
// rules can be tested. A drop only makes changes the designer already makes
// from Show as and the Add buttons.

import type { ScreenDefinition, Target } from '@veneer/screens';
import type { FieldSnapshot, ScreenSnapshot } from '@veneer/terminal';
import { homeOf, isBox, itemAt } from '@veneer/view';
import type { Item, ScreenView, TableItem, TextItem } from '@veneer/view';
import { takesNumbers } from '../ui/fieldRules.ts';
import { DISPLAY_CHOICES, defaultDisplay, defaultWidget } from './defaults.ts';
import { componentForField, componentForFieldChange, displayOf, freeSpot, setComponent, setDisplay, setPlaced, setWidget, textAreaOf, widgetOf } from './edit.ts';
import { labelAt } from './names.ts';

export type PaletteItem =
  | { kind: 'widget'; type: string }
  | { kind: 'display'; type: string }
  | { kind: 'label' }
  | { kind: 'image' }
  | { kind: 'component'; name: string };

/** Field widgets in the palette, as Show as names them (the plain text box is not one). */
export const WIDGET_ITEMS: Array<{ type: string; label: string }> = [
  { type: 'select', label: 'Dropdown' },
  { type: 'radio', label: 'Radio buttons' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'toggle', label: 'Switch' },
  { type: 'date', label: 'Date picker' },
  { type: 'time', label: 'Time picker' },
  { type: 'spinner', label: 'Spinner' },
  { type: 'textarea', label: 'Text area' },
  { type: 'mask', label: 'Masked input' },
  { type: 'lookup', label: 'Lookup' },
];

/** What a palette item is called, for messages ("a Dropdown"). */
export function itemName(item: PaletteItem): string {
  switch (item.kind) {
    case 'widget': return WIDGET_ITEMS.find((w) => w.type === item.type)?.label ?? item.type;
    case 'display': return DISPLAY_CHOICES.find((d) => d.value === item.type)?.label ?? item.type;
    case 'label': return 'Label';
    case 'image': return 'Image';
    case 'component': return `${item.name} component`;
  }
}

const article = (name: string) => (/^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`);
const lower = (name: string) => (/^[A-Z][a-z]/.test(name) ? name[0]!.toLowerCase() + name.slice(1) : name);
/** "a date picker", "an image", "a list-table component". */
export const itemPhrase = (item: PaletteItem) => article(lower(itemName(item)));
const called = itemPhrase;

/** The cells a drop would fill or change, to show while dragging. */
export interface Box {
  row: number;
  col: number;
  width: number;
  height: number;
}

/** What is under a screen cell, as far as dropping goes. */
export type DropTarget =
  | { kind: 'field'; field: FieldSnapshot }
  | { kind: 'text'; item: TextItem; at: Target }
  /** A list; `column` is the column under the cell, when it is one of text with a heading. */
  | { kind: 'list'; table: TableItem; column?: { heading: string; sample: string; col: number; width: number }; columnProblem?: string }
  | { kind: 'empty'; at: Target }
  | { kind: 'other'; what: string; box: Box };

const BOX_NAMES: Record<string, string> = { label: 'a label', image: 'an image', component: 'a component', html: 'custom HTML' };

function boxOf(i: Item): Box {
  const h = homeOf(i);
  const height = 'height' in i && typeof i.height === 'number' ? i.height : 1;
  return { row: h.row, col: h.col, width: i.width, height };
}

/** What is under `at`: an input field, text, a list (and its column), an empty spot, or something else. */
export function targetAt(view: ScreenView, snap: ScreenSnapshot, at: Target): DropTarget | null {
  if (at.row < 1 || at.col < 1 || at.row > snap.rows || at.col > snap.cols) return null;
  const header = itemAt(view.meta, at);
  if (header) return { kind: 'other', what: 'the page header', box: boxOf(header) };
  const items = [...view.items, ...(view.window?.items ?? [])];
  const item = itemAt(items, at);
  // A component drawing a field still stands for the field.
  if (item?.kind === 'component' && item.field) return { kind: 'field', field: item.field };
  if (item && isBox(item)) return { kind: 'other', what: BOX_NAMES[item.kind] ?? 'something', box: boxOf(item) };
  const field = snap.fields.find((f) => !f.bypass && f.row === at.row && at.col >= f.col && at.col < f.col + Math.max(1, f.length));
  if (field) return { kind: 'field', field };
  if (item?.kind === 'table') return listTarget(item, at);
  if (item?.kind === 'text') return { kind: 'text', item, at: homeOf(item) };
  if (item?.kind === 'link') return { kind: 'other', what: 'a menu option', box: boxOf(item) };
  if (item) return { kind: 'other', what: 'that', box: boxOf(item) };
  return { kind: 'empty', at };
}

function listTarget(table: TableItem, at: Target): DropTarget {
  const k = table.columns.findIndex((c) => at.col >= c.col && at.col < c.col + c.width);
  const c = table.columns[k];
  if (!c) return { kind: 'list', table };
  const heading = c.header.trim();
  const sample = table.rows.map((r) => r.cells[k]).find((x) => x && !x.field && x.text.trim())?.text ?? '';
  const hasText = table.rows.some((r) => r.cells[k] && !r.cells[k]!.field);
  if (!heading) return { kind: 'list', table, columnProblem: 'That column has no heading to name it by.' };
  if (!hasText) return { kind: 'list', table, columnProblem: 'That column holds input fields; drop a field widget on one of them instead.' };
  return { kind: 'list', table, column: { heading, sample, col: c.col, width: c.width } };
}

export type DropPlan =
  | {
    ok: true;
    /** The definition after the drop. */
    def: ScreenDefinition;
    /** What to select afterwards, so the Selected tab opens on the new item. */
    select: Target;
    /** For a list column's display: the column, to open its settings on. */
    column?: string;
    /** Set when the drop replaces a widget, display or component: what it replaces, for a question first. */
    replaces?: string;
    /** For a component over a list: the list, its options legend and its More.../Bottom marker, to offer to hide. */
    hide?: Target[];
    /** What the drop does, for the drag's hint and screen readers. */
    message: string;
    box: Box;
  }
  | { ok: false; message: string; box?: Box };

/** The default size of a new component or image, kept inside the screen. */
function sizeAt(snap: ScreenSnapshot, at: Target, width: number, height: number): { width: number; height: number } {
  return { width: Math.max(1, Math.min(width, snap.cols - at.col + 1)), height: Math.max(1, Math.min(height, snap.rows - at.row + 1)) };
}

/** A component's size when placed on an empty spot (as Add component). */
export const COMPONENT_SIZE = { width: 40, height: 4 };
export const IMAGE_SIZE = { width: 12, height: 4 };

/** The cells an item would cover if dropped on an empty spot at `at`. */
export function ghostBox(snap: ScreenSnapshot, item: PaletteItem, at: Target): Box {
  const size = item.kind === 'component' ? sizeAt(snap, at, COMPONENT_SIZE.width, COMPONENT_SIZE.height)
    : item.kind === 'image' ? sizeAt(snap, at, IMAGE_SIZE.width, IMAGE_SIZE.height)
    : item.kind === 'label' ? sizeAt(snap, at, 9, 1)
    : { width: 1, height: 1 };
  return { ...at, ...size };
}

/** What the field is now shown as, if anything: "the Date picker", "the scanner component". */
function fieldShownAs(def: ScreenDefinition, f: FieldSnapshot): string | undefined {
  const component = componentForField(def, f.id);
  if (component) return `the ${component.name} component`;
  const widget = widgetOf(def, f.id);
  if (!widget) return undefined;
  return `the ${lower(WIDGET_ITEMS.find((w) => w.type === widget.type)?.label ?? widget.type)}`;
}

const displayName = (type: string) => lower(DISPLAY_CHOICES.find((d) => d.value === type)?.label ?? type);

/** Plan dropping `item` at `at`: the definition it makes, or why it can't go there. */
export function planDrop(view: ScreenView, snap: ScreenSnapshot, def: ScreenDefinition, item: PaletteItem, at: Target): DropPlan {
  const target = targetAt(view, snap, at);
  const name = itemName(item);
  if (!target) return { ok: false, message: `${capital(called(item))} goes on the screen.` };
  const wrong = (where: string): DropPlan => ({
    ok: false,
    message: `${capital(called(item))} goes on ${where}${target.kind === 'other' ? `, not on ${target.what}` : ''}.`,
    ...(target.kind === 'other' ? { box: target.box } : {}),
  });

  if (item.kind === 'widget') {
    if (target.kind !== 'field') return wrong('an input field');
    const f = target.field;
    const box = { row: f.row, col: f.col, width: Math.max(1, f.length), height: 1 };
    const area = textAreaOf(def, f.id);
    if (area && area.first !== f.id) return { ok: false, box, message: 'That field is a line of a text area; drop it on the text area\'s first line.' };
    if (item.type === 'spinner' && !takesNumbers(f)) return { ok: false, box, message: 'A spinner goes on a field that takes numbers.' };
    if (!componentForField(def, f.id) && widgetOf(def, f.id)?.type === item.type) return { ok: false, box, message: `That field is already ${article(lower(name))}.` };
    const widget = defaultWidget(item.type, f);
    if (!widget) return { ok: false, message: `${name} is not a field widget.` };
    const component = componentForField(def, f.id);
    const cleared = component ? setComponent(def, component.at, null) : def;
    const replaces = fieldShownAs(def, f);
    return {
      ok: true, def: setWidget(cleared, f.id, widget), select: { row: f.row, col: f.col }, box,
      message: `Make ${fieldName(view, snap, f)} ${article(lower(name))}${replaces ? `, in place of ${replaces}` : ''}.`,
      ...(replaces ? { replaces } : {}),
    };
  }

  if (item.kind === 'display') {
    if (target.kind === 'text') {
      const box = boxOf(target.item);
      const current = displayOf(def, { at: target.at });
      if (current?.type === item.type) return { ok: false, box, message: `That text is already shown as ${article(lower(name))}.` };
      const text = (snap.lines[target.at.row - 1] ?? '').slice(target.at.col - 1, target.at.col - 1 + target.item.width);
      const display = defaultDisplay(item.type, text);
      if (!display) return { ok: false, message: `${name} is not a way to show text.` };
      const replaces = current ? `the ${displayName(current.type)}` : undefined;
      return {
        ok: true, def: setDisplay(def, { at: target.at }, display), select: target.at, box,
        message: `Show “${text.trim()}” as ${article(lower(name))}${replaces ? `, in place of ${replaces}` : ''}.`,
        ...(replaces ? { replaces } : {}),
      };
    }
    if (target.kind === 'list') {
      const t = target.table;
      if (!target.column) return { ok: false, box: boxOf(t), message: target.columnProblem ?? `${capital(called(item))} goes on a column of the list.` };
      const { heading, sample } = target.column;
      const box = { row: t.row + t.headerRows, col: target.column.col, width: target.column.width, height: Math.max(1, t.height - t.headerRows) };
      const current = displayOf(def, { column: heading });
      if (current?.type === item.type) return { ok: false, box, message: `The ${heading} column is already shown as ${article(lower(name))}.` };
      const display = defaultDisplay(item.type, sample);
      if (!display) return { ok: false, message: `${name} is not a way to show text.` };
      const replaces = current ? `the ${displayName(current.type)}` : undefined;
      return {
        ok: true, def: setDisplay(def, { column: heading }, display), select: homeOf(t), column: heading, box,
        message: `Show the ${heading} column as ${article(lower(name))}${replaces ? `, in place of ${replaces}` : ''}.`,
        ...(replaces ? { replaces } : {}),
      };
    }
    return wrong('text or a list column');
  }

  if (item.kind === 'label' || item.kind === 'image') {
    if (target.kind !== 'empty') return wrong('an empty spot');
    const spec = item.kind === 'label'
      ? { at, text: 'New label' }
      : { at, src: 'logo.png', alt: '', ...sizeAt(snap, at, IMAGE_SIZE.width, IMAGE_SIZE.height) };
    return {
      ok: true, def: setPlaced(def, at, spec), select: at, box: ghostBox(snap, item, at),
      message: `Add ${item.kind === 'label' ? 'a label' : 'an image'} at row ${at.row}, column ${at.col}.`,
    };
  }

  // A component: in place of a field, over a list, or on an empty spot.
  if (target.kind === 'field') {
    const f = target.field;
    const box = { row: f.row, col: f.col, width: Math.max(1, f.length), height: 1 };
    const area = textAreaOf(def, f.id);
    if (area && area.first !== f.id) return { ok: false, box, message: 'That field is a line of a text area; drop it on the text area\'s first line.' };
    const current = componentForField(def, f.id);
    if (current?.name === item.name) return { ok: false, box, message: `That field is already drawn by the ${item.name} component.` };
    const replaces = fieldShownAs(def, f);
    let next = current ? setComponent(def, current.at, null) : def;
    next = setComponent(setWidget(next, f.id, null), { row: f.row, col: f.col }, componentForFieldChange(item.name, f));
    return {
      ok: true, def: next, select: { row: f.row, col: f.col }, box,
      message: `Draw ${fieldName(view, snap, f)} with the ${item.name} component${replaces ? `, in place of ${replaces}` : ''}.`,
      ...(replaces ? { replaces } : {}),
    };
  }
  if (target.kind === 'list') {
    const t = target.table;
    const home = homeOf(t);
    const box = { row: t.row, col: t.col, width: t.width, height: t.height };
    return {
      ok: true, def: setComponent(def, home, { name: item.name, at: home, width: t.width, height: t.height }), select: home, box,
      hide: listParts(view, t),
      message: `Put the ${item.name} component over the list.`,
    };
  }
  if (target.kind === 'empty') {
    const size = sizeAt(snap, at, COMPONENT_SIZE.width, COMPONENT_SIZE.height);
    return {
      ok: true, def: setComponent(def, at, { name: item.name, at, ...size }), select: at, box: { ...at, ...size },
      message: `Add the ${item.name} component at row ${at.row}, column ${at.col}.`,
    };
  }
  return wrong('an empty spot, an input field or a list');
}

/** The places an item can go, one cell each, in reading order: a field, text or column once, a run of empty cells once. */
export function spots(view: ScreenView, snap: ScreenSnapshot, def: ScreenDefinition, item: PaletteItem): Target[] {
  const out: Target[] = [];
  let last = '';
  for (let row = 1; row <= snap.rows; row++) {
    for (let col = 1; col <= snap.cols; col++) {
      const plan = planDrop(view, snap, def, item, { row, col });
      const key = !plan.ok ? '' : targetAt(view, snap, { row, col })?.kind === 'empty' ? `empty ${row}` : JSON.stringify(plan.box);
      if (key && key !== last) out.push({ row, col });
      last = key;
    }
  }
  return out;
}

/** Where placing with the keyboard starts: a free spot for things that go on one, else the first place the item can go. */
export function firstSpot(view: ScreenView, snap: ScreenSnapshot, def: ScreenDefinition, item: PaletteItem): Target {
  if (item.kind === 'label' || item.kind === 'image' || item.kind === 'component') {
    const free = freeSpot(snap, def, item.kind === 'label' ? 1 : 4);
    if (planDrop(view, snap, def, item, free).ok) return free;
  }
  return spots(view, snap, def, item)[0] ?? { row: 1, col: 1 };
}

/** A list's own items, to hide under a component: the list, its options legend above it, and its More.../Bottom marker. */
export function listParts(view: ScreenView, t: TableItem): Target[] {
  const bottom = t.row + t.height - 1;
  const legend = view.items.filter((i) => i.kind === 'text' && i.row < t.row && i.row >= t.row - 4
    && (/\b\d{1,2}=\S/.test(i.text) || /^Type options/i.test(i.text.trim())));
  const marker = view.items.filter((i) => (i.row === bottom || i.row === bottom + 1)
    && ((i.kind === 'link' && i.key === '' && i.action.aid === 'PageDown') || (i.kind === 'text' && i.text.trim() === 'Bottom')));
  return [homeOf(t), ...legend.map(homeOf), ...marker.map(homeOf)];
}

function fieldName(view: ScreenView, snap: ScreenSnapshot, f: FieldSnapshot): string {
  const label = labelAt(view, snap, { row: f.row, col: f.col }, { shown: true });
  return label ? `“${label}”` : `field ${f.id}`;
}

const capital = (s: string) => s[0]!.toUpperCase() + s.slice(1);
