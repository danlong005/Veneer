// The designer's Cards and tabs section: framed panels around parts of the
// screen, and tabs that split its rows into bands shown one at a time.

import type { ScreenDefinition } from '@veneer/screens';
import type { ScreenView } from '../transform/types.ts';
import { cardsOf, moveTabEdge, removeTab, setCard, setTabs, splitTabs, tabRegion, tabsOf, type Selection } from './edit.ts';
import { Section } from './Section.tsx';

interface Props {
  draft: ScreenDefinition;
  setDraft: (d: ScreenDefinition) => void;
  view: ScreenView;
  selection: Selection | null;
}

/** The row the selection is drawn on (moved items are drawn away from their home). */
export function selectedRow(selection: Selection | null): number | undefined {
  if (!selection || (selection.kind === 'item' && selection.header)) return undefined;
  return selection.kind === 'empty' ? selection.at.row : selection.item?.row ?? selection.at.row;
}

const num = (value: string) => Math.min(27, Math.max(1, Math.trunc(Number(value)) || 1));

export function CardsAndTabs({ draft, setDraft, view, selection }: Props) {
  const cards = cardsOf(draft);
  const tabs = tabsOf(draft);
  const row = selectedRow(selection);
  const split = row !== undefined ? splitTabs(tabs, row, tabRegion(view)) : tabs;
  // A tab starting inside a card would split it, which saving refuses.
  const cutsCard = row !== undefined && cards.some((c) => row > c.from.row && row <= c.to.row);
  const canSplit = split !== tabs && !cutsCard;

  return (
    <>
      <Section title="Cards" count={cards.length}>
        {cards.length === 0 && (
          <p className="dp-hint">Group items in a framed panel: select an item, then choose Add card around it.</p>
        )}
        {cards.map((c) => (
          <div key={`${c.from.row}:${c.from.col}`} className="dp-card">
            <input
              aria-label="Card title"
              placeholder="Title (optional)"
              value={c.title ?? ''}
              onChange={(e) => {
                const { title: _old, ...rest } = c;
                setDraft(setCard(draft, c.from, e.target.value ? { ...rest, title: e.target.value } : rest));
              }}
            />
            <button type="button" className="dp-x" aria-label="Remove card" onClick={() => setDraft(setCard(draft, c.from, null))}>×</button>
            <span className="dp-hint">Rows {c.from.row}–{c.to.row}, columns {c.from.col}–{c.to.col}</span>
          </div>
        ))}
        {cards.length > 0 && <p className="dp-hint">Drag a card's corner on the screen to resize it. Move items in or out of it as usual.</p>}
      </Section>

      <Section title="Tabs" count={tabs.length}>
        {tabs.length === 0 && (
          <p className="dp-hint">Split a long screen into tabs: select something on the row where the second tab should start.</p>
        )}
        {tabs.map((t, i) => (
          <div key={i} className="dp-tab">
            <input
              aria-label={`Tab ${i + 1} title`}
              value={t.title}
              onChange={(e) => setDraft(setTabs(draft, tabs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x))))}
            />
            <label className="dp-row">From row
              <input type="number" min={1} max={27} value={t.from}
                onChange={(e) => setDraft(setTabs(draft, moveTabEdge(tabs, i, num(e.target.value))))} />
            </label>
            <label className="dp-row">to
              <input type="number" min={1} max={27} value={t.to} disabled={i < tabs.length - 1}
                title={i < tabs.length - 1 ? 'Ends where the next tab starts' : undefined}
                onChange={(e) => setDraft(setTabs(draft, moveTabEdge(tabs, tabs.length, num(e.target.value))))} />
            </label>
            <button type="button" className="dp-x" aria-label={`Remove tab ${t.title}`} onClick={() => setDraft(setTabs(draft, removeTab(tabs, i)))}>×</button>
          </div>
        ))}
        <button type="button" className="ghost" disabled={!canSplit} onClick={() => setDraft(setTabs(draft, split))}>
          {row !== undefined && canSplit ? `Start a tab at row ${row}` : 'Start a tab at the selected row'}
        </button>
        {cutsCard && <p className="dp-hint">Row {row} is inside a card; a tab cannot start there.</p>}
        {tabs.length > 0 && <p className="dp-hint">Click the tab titles on the screen to see each tab. Fields on hidden tabs are still sent.</p>}
      </Section>
    </>
  );
}
