// The designer's Palette tab (#55): what can be placed on the screen, to drag
// onto it, or to pick and then click (or, with the keyboard, choose with the
// arrow keys) where it goes. The rules for where each item goes are drop.ts's.

import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { DISPLAY_CHOICES } from './defaults.ts';
import { WIDGET_ITEMS, type PaletteItem } from './drop.ts';

/** How placing began: dragging from the palette, or picking an item (by click or key) and then choosing its place. */
export type PlaceStart = { via: 'drag'; x: number; y: number } | { via: 'pick'; keys: boolean };

const same = (a: PaletteItem | null, b: PaletteItem) => a !== null && JSON.stringify(a) === JSON.stringify(b);

export function Palette({ components, placing, onStart, onCancel, children }: {
  /** Shown above the items: what is being placed, and why a drop didn't take. */
  children?: ReactNode;
  /** Installed components. */
  components: string[];
  /** The item being placed, if any. */
  placing: PaletteItem | null;
  onStart: (item: PaletteItem, how: PlaceStart) => void;
  onCancel: () => void;
}) {
  const button = (item: PaletteItem, label: string, title: string) => (
    <li key={label}>
      <button
        type="button"
        className={`dp-palette-item${same(placing, item) ? ' on' : ''}`}
        aria-pressed={same(placing, item)}
        title={title}
        onPointerDown={(e: ReactPointerEvent<HTMLButtonElement>) => {
          if (e.button !== 0) return;
          // No text selection or focus change while dragging out of the panel.
          e.preventDefault();
          onStart(item, { via: 'drag', x: e.clientX, y: e.clientY });
        }}
        onClick={(e) => {
          // A pointer press already started placing; a key (Enter or Space) picks the item to place with the keyboard.
          if (e.detail !== 0) return;
          if (same(placing, item)) onCancel();
          else onStart(item, { via: 'pick', keys: true });
        }}
      >
        {label}
      </button>
    </li>
  );
  return (
    <>
      <section>
        {children}
        <p className="dp-hint">
          Drag an item onto the screen, or click one and then click where it goes. With the keyboard: Enter on an item, then the arrow
          keys (or Tab for the next place it fits) and Enter to drop it. Esc cancels.
        </p>
      </section>
      <section className="dp-palette">
        <h4>Field widgets</h4>
        <p className="dp-hint">On an input field.</p>
        <ul>{WIDGET_ITEMS.map((w) => button({ kind: 'widget', type: w.type }, w.label, `${w.label}: drop on an input field`))}</ul>
      </section>
      <section className="dp-palette">
        <h4>Output text</h4>
        <p className="dp-hint">On some text, or on a list column to show every cell that way.</p>
        <ul>{DISPLAY_CHOICES.map((d) => button({ kind: 'display', type: d.value }, d.label, `${d.label}: drop on text or a list column`))}</ul>
      </section>
      <section className="dp-palette">
        <h4>Labels and images</h4>
        <p className="dp-hint">On an empty spot.</p>
        <ul>
          {button({ kind: 'label' }, 'Label', 'Label: drop on an empty spot')}
          {button({ kind: 'image' }, 'Image', 'Image: drop on an empty spot')}
        </ul>
      </section>
      <section className="dp-palette">
        <h4>Components</h4>
        {components.length === 0 ? (
          <p className="dp-hint">No components are installed. Developers add them as name.js files in the server's components folder (VENEER_COMPONENTS_DIR).</p>
        ) : (
          <>
            <p className="dp-hint">On an empty spot; on an input field, to draw the field; or on a list, to show the list with it.</p>
            <ul>{components.map((name) => button({ kind: 'component', name }, name, `${name}: drop on an empty spot, an input field or a list`))}</ul>
          </>
        )}
      </section>
    </>
  );
}
