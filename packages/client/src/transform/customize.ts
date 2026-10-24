// Applies a screen definition's changes to an auto-transformed view. Items are
// found by their screen position, so changes survive data changing on screen.

import type { ScreenDefinition, Target } from '@veneer/screens';
import type { HtmlItem, Item, ScreenView } from './types.ts';

export interface CustomizeOptions {
  /** Designer mode: keep hidden items (marked hidden) so they can be selected. */
  design?: boolean;
}

/** Rows an item covers. */
export const heightOf = (i: Item) => (i.kind === 'table' || i.kind === 'html' ? i.height : 1);

/** The item covering a target cell. Custom HTML is drawn on top, so it wins. */
export function itemAt(items: readonly Item[], at: Target): Item | undefined {
  const covers = (i: Item) => at.row >= i.row && at.row < i.row + heightOf(i) && at.col >= i.col && at.col < i.col + i.width;
  return items.find((i) => i.kind === 'html' && covers(i)) ?? items.find(covers);
}

export function customize(view: ScreenView, def: ScreenDefinition | undefined, opts: CustomizeOptions = {}): ScreenView {
  if (!def) return view;
  const out: ScreenView = {
    ...view,
    items: view.items.map((i) => ({ ...i })),
    ...(view.window ? { window: { ...view.window, items: view.window.items.map((i) => ({ ...i })) } } : {}),
    buttons: [],
    definition: { id: def.id, name: def.name },
  };
  if (def.title) out.title = def.title;
  if (def.css) out.css = def.css;
  if (def.scripts) out.scripts = def.scripts;
  const all = () => [...out.items, ...(out.window?.items ?? [])];

  for (const change of def.changes) {
    switch (change.op) {
      case 'hide': {
        const item = itemAt(all(), change.at);
        if (item) item.hidden = true;
        break;
      }
      case 'text': {
        const item = itemAt(all(), change.at);
        if (item?.kind === 'text' || item?.kind === 'link') item.text = change.text;
        break;
      }
      case 'role': {
        const item = itemAt(all(), change.at);
        if (item?.kind === 'text') item.role = change.role;
        break;
      }
      case 'widget':
        for (const item of all()) {
          if (item.kind === 'field' && item.field.id === change.field) item.widget = change.widget;
          if (item.kind === 'table') {
            item.rows = item.rows.map((r) => ({
              ...r,
              cells: r.cells.map((c) => (c.field?.id === change.field ? { ...c, widget: change.widget } : c)),
            }));
          }
        }
        break;
      case 'button':
        out.buttons.push({ label: change.label, action: change.action });
        break;
      case 'html': {
        const item: HtmlItem = {
          kind: 'html', row: change.at.row, col: change.at.col, width: change.width, height: change.height, html: change.html,
          ...(change.css ? { css: change.css } : {}),
          ...(change.script ? { script: change.script } : {}),
        };
        // Inside an active window it goes in the window, above the dimmed screen.
        const w = out.window;
        if (w && item.row >= w.top && item.row <= w.bottom && item.col >= w.left && item.col <= w.right) w.items.push(item);
        else out.items.push(item);
        break;
      }
    }
  }

  if (!opts.design) {
    out.items = out.items.filter((i) => !i.hidden);
    if (out.window) out.window.items = out.window.items.filter((i) => !i.hidden);
  }
  return out;
}
