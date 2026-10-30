// One line per change in a definition, for the designer's Changes list:
// what it does, and where on the screen (to select it), if anywhere.

import { testOf, type Change, type Target } from '@veneer/screens';
import type { ScreenSnapshot } from '@veneer/tn5250';
import { ROLE_LABELS } from './edit.ts';

export interface ChangeLine {
  label: string;
  /** The screen position the change applies to, to select it. */
  at?: Target;
}

const WIDGET_LABELS = { select: 'a drop-down list', checkbox: 'a checkbox', date: 'a date picker' } as const;

/** What is at a position: the host's text there (up to a wide gap), or the input field. */
export function nameAt(snap: ScreenSnapshot, at: Target): string {
  if (snap.fields.some((f) => f.row === at.row && f.col === at.col)) return `field ${at.row}:${at.col}`;
  const text = labelText((snap.lines[at.row - 1] ?? '').slice(at.col - 1));
  return text ? `“${clip(text)}”` : `row ${at.row}, column ${at.col}`;
}

export function describeChange(change: Change, snap: ScreenSnapshot): ChangeLine {
  switch (change.op) {
    case 'hide':
      return { label: `Hide ${nameAt(snap, change.at)}`, at: change.at };
    case 'text':
      return { label: `Change ${nameAt(snap, change.at)} to “${clip(change.text)}”`, at: change.at };
    case 'role':
      return { label: `Show ${nameAt(snap, change.at)} as ${ROLE_LABELS[change.role]}`, at: change.at };
    case 'widget': {
      const [row, col] = change.field.split(':').map(Number) as [number, number];
      return { label: `Show field ${change.field} as ${WIDGET_LABELS[change.widget.type]}`, at: { row, col } };
    }
    case 'move':
      return { label: `Move ${nameAt(snap, change.at)} to row ${change.to.row}, column ${change.to.col}`, at: change.at };
    case 'button':
      return { label: `Button “${clip(change.label)}”: ${'url' in change.action ? 'opens a web page' : `presses ${change.action.aid}`}` };
    case 'style': {
      const { test, value } = testOf(change.when);
      const subject = change.when.column !== undefined ? `column “${change.when.column}”` : nameAt(snap, change.when.at!);
      return {
        label: `${ROLE_LABELS[change.role]} when ${subject} ${TEST_WORDS[test]} “${clip(String(value))}”`,
        ...(change.when.at ? { at: change.when.at } : {}),
      };
    }
    case 'card':
      return {
        label: `Card${change.title ? ` “${clip(change.title)}”` : ''}, rows ${change.from.row}–${change.to.row}`,
        at: change.from,
      };
    case 'tabs':
      return { label: `Tabs: ${change.tabs.map((t) => t.title || 'Untitled').join(', ')}` };
    case 'component':
      return { label: `Component ${change.name}${change.field ? ` for field ${change.field}` : ''}`, at: change.at };
    case 'html': {
      const text = change.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      return { label: `HTML ${text ? `“${clip(text)}”` : '(no text)'}`, at: change.at };
    }
  }
}

const TEST_WORDS = { equals: 'is', contains: 'contains', matches: 'matches', lessThan: 'is under', greaterThan: 'is over' } as const;

/** A label as people read it: up to a wide gap, without the dot leaders and colon of "Customer . . . :". */
export function labelText(text: string): string {
  return text.split(/\s{2,}(?![.:])/)[0]!.replace(/(?:\s*\.){2,}\s*:?\s*$|\s*:\s*$/, '').trim();
}

function clip(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
