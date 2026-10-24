// Screen definitions: how to recognise a screen, and what to change on it.
// Stored as one JSON file per screen, so they can be reviewed in git.

import type { AidName } from '@veneer/tn5250';

/** Semantic color roles (CUA conventions mapped from 5250 colors). */
export const ROLES = ['normal', 'emphasis', 'muted', 'danger', 'warning', 'accent', 'accent2'] as const;
export type Role = (typeof ROLES)[number];

/** A screen position: the first cell of the item being changed (1-based). */
export interface Target {
  row: number;
  col: number;
}

/** Text that must appear at a position for the screen to match. */
export interface TextMatch extends Target {
  text: string;
}

/**
 * How a definition recognises its screen: any of the screen ids (see
 * fingerprint.ts), and all of the text rules. At least one of the two is needed.
 */
export interface Match {
  /** Screen ids this definition applies to (variants such as an empty list). */
  screenIds?: string[];
  /** Screen size, when the definition only applies to 24x80 or 27x132. */
  rows?: number;
  cols?: number;
  /** Text that must also appear at fixed positions. */
  text: TextMatch[];
}

export const DATE_FORMATS = ['YYYYMMDD', 'MMDDYYYY', 'MMDDYY', 'DDMMYYYY', 'DDMMYY', 'YYMMDD', 'MM/DD/YYYY', 'MM/DD/YY', 'DD/MM/YYYY', 'YYYY-MM-DD'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export interface SelectOption {
  value: string;
  label: string;
}

export type Widget =
  | { type: 'select'; options: SelectOption[] }
  | { type: 'checkbox'; on: string; off: string }
  | { type: 'date'; format: DateFormat };

export interface ButtonAction {
  aid: AidName;
  /** Field values to type before pressing the key, by field id ("row:col"). */
  fields?: Record<string, string>;
}

export type Change =
  | { op: 'hide'; at: Target }
  | { op: 'text'; at: Target; text: string }
  | { op: 'role'; at: Target; role: Role }
  | { op: 'widget'; field: string; widget: Widget }
  | { op: 'button'; label: string; action: ButtonAction }
  /** Custom HTML drawn over the screen at a position, `width` x `height` cells. */
  | { op: 'html'; at: Target; html: string; width: number; height: number };

export interface ScreenDefinition {
  /** File name and URL id: lowercase letters, digits and dashes. */
  id: string;
  name: string;
  match: Match;
  /** Replaces the detected page title. */
  title?: string;
  changes: Change[];
  /** CSS added to the page while this screen is shown. */
  css?: string;
  /**
   * JavaScript run each time this screen is shown, as the body of
   * `function (veneer, screen)`. It may return a cleanup function.
   */
  script?: string;
}

/** Site-wide CSS and JavaScript, on every page (global.css and global.js). */
export interface SiteCustomization {
  css: string;
  script: string;
}
