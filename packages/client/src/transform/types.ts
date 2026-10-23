// The view model produced by the auto-transform pipeline. Every item keeps
// its 5250 row/column so the layout stays faithful to the original screen.

import type { AidName, FieldSnapshot, ScreenSnapshot } from '@veneer/tn5250';

/** Semantic color roles mapped from 5250 colors (CUA conventions). */
export type Role = 'normal' | 'emphasis' | 'muted' | 'danger' | 'warning' | 'accent' | 'accent2';

export interface Placed {
  /** 1-based row and column. */
  row: number;
  col: number;
  /** Width in character cells. */
  width: number;
}

export interface Action {
  aid: AidName;
  fields?: Record<string, string>;
}

export interface Option {
  value: string;
  label: string;
}

export interface TextItem extends Placed {
  kind: 'text';
  text: string;
  role: Role;
  reverse: boolean;
  underline: boolean;
}

export interface FieldItem extends Placed {
  kind: 'field';
  field: FieldSnapshot;
  /** Text label found to the left, for accessibility. */
  label?: string;
  /** Command line (follows "===>"). */
  command?: boolean;
  options?: Option[];
}

export interface LinkItem extends Placed {
  kind: 'link';
  text: string;
  /** Leading menu number, e.g. "1". */
  key: string;
  action: Action;
}

export interface TableCell {
  col: number;
  width: number;
  text: string;
  role: Role;
  field?: FieldSnapshot;
  options?: Option[];
}

export interface TableRow {
  row: number;
  cells: TableCell[];
}

export interface TableColumn {
  col: number;
  width: number;
  header: string;
}

export interface TableItem extends Placed {
  kind: 'table';
  /** Rows covered, header included. */
  height: number;
  /** Number of header rows at the top of the table. */
  headerRows: number;
  columns: TableColumn[];
  rows: TableRow[];
  /** Host indicated more records ("More..."); false at "Bottom". */
  more: boolean;
}

export type Item = TextItem | FieldItem | LinkItem | TableItem;

export interface FunctionKey {
  aid: AidName;
  label: string;
}

/** A pop-up window: rendered as a modal card over the dimmed screen. */
export interface WindowView {
  /** Interior of the window (border excluded), 1-based and inclusive. */
  top: number;
  left: number;
  bottom: number;
  right: number;
  title?: string;
  items: Item[];
  functionKeys: FunctionKey[];
  message?: { text: string; kind: 'error' | 'info' };
}

export interface ScreenView {
  rows: number;
  cols: number;
  title?: string;
  /** Other header text from the title row (program name, system name). */
  meta: string[];
  items: Item[];
  functionKeys: FunctionKey[];
  message?: { text: string; kind: 'error' | 'info' };
  /** Set when a pop-up window is active; `items` are then the dimmed background. */
  window?: WindowView;
  snapshot: ScreenSnapshot;
}
