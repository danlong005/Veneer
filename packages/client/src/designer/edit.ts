// Pure helpers the designer uses to build and edit screen definitions.

import { screenId, type ButtonAction, type Change, type Role, type ScreenDefinition, type Target, type TextMatch, type Widget } from '@veneer/screens';
import type { FieldSnapshot, ScreenSnapshot } from '@veneer/tn5250';
import { itemAt } from '../transform/customize.ts';
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
  | { kind: 'item'; at: Target; item: Item };

/** Resolve a clicked position: an input field first, else the item covering it. */
export function resolveSelection(view: ScreenView, snap: ScreenSnapshot, at: Target): Selection | null {
  const field = snap.fields.find((f) => !f.bypass && f.row === at.row && f.col === at.col);
  const items = [...view.items, ...(view.window?.items ?? [])];
  const item = itemAt(items, at);
  if (field) return { kind: 'field', at, field, ...(item?.kind === 'field' ? { item } : {}) };
  return item ? { kind: 'item', at: { row: item.row, col: item.col }, item } : null;
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
