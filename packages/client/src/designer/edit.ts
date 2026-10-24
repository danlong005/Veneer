// Pure helpers the designer uses to build and edit screen definitions.

import { screenId, type ButtonAction, type Change, type Role, type ScreenDefinition, type ScreenEvent, type Target, type TextMatch, type Widget } from '@veneer/screens';
import type { FieldSnapshot, ScreenSnapshot } from '@veneer/tn5250';
import { homeOf, itemAt } from '../transform/customize.ts';
import type { Item, ScreenView } from '../transform/types.ts';

const same = (a: Target, b: Target) => a.row === b.row && a.col === b.col;

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'screen';
}

/** A new definition for this screen, recognised by its screen id. */
export function newDefinition(snap: ScreenSnapshot, view: ScreenView): ScreenDefinition {
  const name = view.title ?? 'New screen';
  return { id: slug(name), name, match: { screenIds: [screenId(snap)], text: [] }, changes: [] };
}

export function addScreenId(def: ScreenDefinition, id: string): ScreenDefinition {
  const ids = def.match.screenIds ?? [];
  return ids.includes(id) ? def : { ...def, match: { ...def.match, screenIds: [...ids, id] } };
}

export function removeScreenId(def: ScreenDefinition, id: string): ScreenDefinition {
  const ids = (def.match.screenIds ?? []).filter((x) => x !== id);
  const { screenIds: _omit, ...rest } = def.match;
  return { ...def, match: ids.length > 0 ? { ...rest, screenIds: ids } : rest };
}

/** The screen text under an item, as the host sent it (for a match rule). */
export function originalText(snap: ScreenSnapshot, item: { row: number; col: number; width: number }): TextMatch | null {
  const text = (snap.lines[item.row - 1] ?? '').slice(item.col - 1, item.col - 1 + item.width).trimEnd();
  return text.trim() ? { row: item.row, col: item.col, text } : null;
}

// ---- what is selected -------------------------------------------------------

export type Selection =
  | { kind: 'field'; at: Target; field: FieldSnapshot; item?: Item }
  | { kind: 'item'; at: Target; item: Item }
  | { kind: 'empty'; at: Target };

/** Resolve a clicked position: custom HTML or an input field first, else the item covering it, else the empty cell. */
export function resolveSelection(view: ScreenView, snap: ScreenSnapshot, at: Target): Selection | null {
  const items = [...view.items, ...(view.window?.items ?? [])];
  const item = itemAt(items, at);
  if (item?.kind === 'html') return { kind: 'item', at: homeOf(item), item };
  const field = snap.fields.find((f) => !f.bypass && f.row === at.row && f.col === at.col);
  if (field) return { kind: 'field', at, field, ...(item?.kind === 'field' ? { item } : {}) };
  if (item) return { kind: 'item', at: homeOf(item), item };
  return at.row <= snap.rows && at.col <= snap.cols ? { kind: 'empty', at } : null;
}

// ---- reading and writing changes -------------------------------------------

type ChangeOf<K extends Change['op']> = Extract<Change, { op: K }>;

function findAt<K extends 'hide' | 'text' | 'role'>(def: ScreenDefinition, op: K, at: Target): ChangeOf<K> | undefined {
  return def.changes.find((c): c is ChangeOf<K> => c.op === op && same((c as { at: Target }).at, at));
}

/** Replace (or with `next` null, remove) the change of one op at one target. */
function putAt(def: ScreenDefinition, op: 'hide' | 'text' | 'role', at: Target, next: Change | null): ScreenDefinition {
  const changes = def.changes.filter((c) => !(c.op === op && same((c as { at: Target }).at, at)));
  return { ...def, changes: next ? [...changes, next] : changes };
}

export const isHidden = (def: ScreenDefinition, at: Target) => findAt(def, 'hide', at) !== undefined;
export const textOf = (def: ScreenDefinition, at: Target) => findAt(def, 'text', at)?.text;
export const roleOf = (def: ScreenDefinition, at: Target) => findAt(def, 'role', at)?.role;

export const setHidden = (def: ScreenDefinition, at: Target, hidden: boolean) =>
  putAt(def, 'hide', at, hidden ? { op: 'hide', at } : null);

export const setText = (def: ScreenDefinition, at: Target, text: string | null) =>
  putAt(def, 'text', at, text === null ? null : { op: 'text', at, text });

export const setRole = (def: ScreenDefinition, at: Target, role: Role | null) =>
  putAt(def, 'role', at, role === null ? null : { op: 'role', at, role });

export function widgetOf(def: ScreenDefinition, field: string): Widget | undefined {
  return def.changes.find((c): c is ChangeOf<'widget'> => c.op === 'widget' && c.field === field)?.widget;
}

export function setWidget(def: ScreenDefinition, field: string, widget: Widget | null): ScreenDefinition {
  const changes = def.changes.filter((c) => !(c.op === 'widget' && c.field === field));
  return { ...def, changes: widget ? [...changes, { op: 'widget', field, widget }] : changes };
}

type Html = ChangeOf<'html'>;

export function htmlAt(def: ScreenDefinition, at: Target): Html | undefined {
  return def.changes.find((c): c is Html => c.op === 'html' && same(c.at, at));
}

/** Add, replace (same position) or with `next` null remove custom HTML. */
export function setHtml(def: ScreenDefinition, at: Target, next: Omit<Html, 'op'> | null): ScreenDefinition {
  const changes = def.changes.map((c) => (c.op === 'html' && same(c.at, at) && next ? { op: 'html' as const, ...next } : c))
    .filter((c) => !(c.op === 'html' && same(c.at, at) && !next));
  return htmlAt(def, at) || !next ? { ...def, changes } : { ...def, changes: [...changes, { op: 'html', ...next }] };
}

/** Where a customization moved the item at `at`, if it did. */
export function moveOf(def: ScreenDefinition, at: Target): Target | undefined {
  return def.changes.find((c): c is ChangeOf<'move'> => c.op === 'move' && same(c.at, at))?.to;
}

/** Move the item at `at` to `to`; null, or its own place, puts it back. */
export function setMove(def: ScreenDefinition, at: Target, to: Target | null): ScreenDefinition {
  const changes = def.changes.filter((c) => !(c.op === 'move' && same(c.at, at)));
  return { ...def, changes: to && !same(to, at) ? [...changes, { op: 'move', at, to }] : changes };
}

export function htmlOf(def: ScreenDefinition): Html[] {
  return def.changes.filter((c): c is Html => c.op === 'html');
}

/**
 * Where "Add HTML" puts a new box `height` rows tall: the first run of blank
 * screen rows below the title not already holding custom HTML, else row 2.
 */
export function freeSpot(snap: ScreenSnapshot, def: ScreenDefinition, height = 1): Target {
  const free = (row: number) => (snap.lines[row - 1] ?? '').trim() === ''
    && !htmlOf(def).some((h) => row >= h.at.row && row < h.at.row + h.height);
  for (let row = 3; row + height - 1 <= snap.rows - 2; row++) {
    if (Array.from({ length: height }, (_, i) => row + i).every(free)) return { row, col: 2 };
  }
  return { row: 2, col: 2 };
}

/** Set or clear (empty string) the definition's CSS. */
export function setCss(def: ScreenDefinition, css: string): ScreenDefinition {
  const { css: _omit, ...rest } = def;
  return css === '' ? rest : { ...rest, css };
}

/** Set or clear (empty string) the script for one screen event. */
export function setScript(def: ScreenDefinition, event: ScreenEvent, code: string): ScreenDefinition {
  const { [event]: _omit, ...others } = def.scripts ?? {};
  const scripts = code === '' ? others : { ...others, [event]: code };
  const { scripts: _old, ...rest } = def;
  return Object.keys(scripts).length > 0 ? { ...rest, scripts } : rest;
}

export function buttonsOf(def: ScreenDefinition): Array<ChangeOf<'button'>> {
  return def.changes.filter((c): c is ChangeOf<'button'> => c.op === 'button');
}

/** Replace the button list, keeping other changes in place. */
export function setButtons(def: ScreenDefinition, buttons: Array<{ label: string; action: ButtonAction }>): ScreenDefinition {
  return {
    ...def,
    changes: [...def.changes.filter((c) => c.op !== 'button'), ...buttons.map((b) => ({ op: 'button' as const, ...b }))],
  };
}

/** Role names as the designer shows them. */
export const ROLE_LABELS: Record<Role, string> = {
  normal: 'Normal', emphasis: 'Bold', muted: 'Muted', danger: 'Error', warning: 'Warning', accent: 'Accent', accent2: 'Highlight',
};

export type StyleRule = Omit<ChangeOf<'style'>, 'op'>;

export function stylesOf(def: ScreenDefinition): StyleRule[] {
  return def.changes.filter((c): c is ChangeOf<'style'> => c.op === 'style').map(({ op: _op, ...rule }) => rule);
}

/** Replace the style rules, keeping other changes in place. Rules apply in order. */
export function setStyles(def: ScreenDefinition, rules: StyleRule[]): ScreenDefinition {
  return {
    ...def,
    changes: [...def.changes.filter((c) => c.op !== 'style'), ...rules.map((r) => ({ op: 'style' as const, ...r }))],
  };
}

// ---- small text formats used by the panel -----------------------------------

/** "value=Label" lines <-> select options. */
export function parseOptions(text: string): Array<{ value: string; label: string }> {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf('=');
    return i < 0 ? { value: l, label: l } : { value: l.slice(0, i).trim(), label: l.slice(i + 1).trim() };
  });
}

export const formatOptions = (options: Array<{ value: string; label: string }>) =>
  options.map((o) => `${o.value}=${o.label}`).join('\n');
