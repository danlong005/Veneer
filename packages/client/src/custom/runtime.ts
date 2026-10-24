// Custom JavaScript from screen definitions and the site-wide global.js.
//
// Designers' code runs with the page's full rights, like the site's own code:
// it can read everything typed, passwords included. Only people trusted to
// change the site should get designer access.
//
// Scripts see one object, `veneer` (also window.veneer):
//   veneer.screen               the screen showing now (see ScreenInfo)
//   veneer.on('screen', fn)     call fn(screen, element) after each screen is drawn; returns an unsubscribe
//   veneer.getField('6:53')     a field's current value, including what the user typed
//   veneer.setField('6:53', v)  type into a field
//   veneer.press('F3', fields?) press a key, optionally filling fields first
// A screen's script is the body of `function (veneer, screen)`, run each time
// the screen is drawn; `screen` is the page element holding it. It may return a
// function, which is called when the screen goes away.

import type { AidName } from '@veneer/tn5250';

export interface ScreenInfo {
  /** Structural screen id (see @veneer/screens fingerprint). */
  id: string;
  /** Id of the screen definition applied, if any. */
  definition?: string;
  rows: number;
  cols: number;
  /** Screen text, one string per row. */
  lines: string[];
  fields: Array<{ id: string; row: number; col: number; length: number; value: string }>;
}

export interface VeneerApi {
  readonly screen: ScreenInfo | null;
  on(event: 'screen', fn: (screen: ScreenInfo, element: HTMLElement) => void): () => void;
  getField(id: string): string | undefined;
  setField(id: string, value: string): void;
  press(aid: AidName, fields?: Record<string, string>): void;
}

/** What the app provides to scripts. */
export interface ScriptHost {
  getField(id: string): string | undefined;
  setField(id: string, value: string): void;
  press(aid: AidName, fields?: Record<string, string>): void;
}

type Listener = (screen: ScreenInfo, element: HTMLElement) => void;

let host: ScriptHost | null = null;
let current: ScreenInfo | null = null;
let currentElement: HTMLElement | null = null;
const listeners = new Set<Listener>();

export const veneer: VeneerApi = {
  get screen() { return current; },
  on(event, fn) {
    if (event !== 'screen') throw new Error(`veneer.on: unknown event "${String(event)}"`);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  getField: (id) => host?.getField(id),
  setField: (id, value) => host?.setField(id, value),
  press: (aid, fields) => host?.press(aid, fields),
};

declare global {
  interface Window { veneer: VeneerApi }
}
if (typeof window !== 'undefined') window.veneer = veneer;

export function connectHost(next: ScriptHost): void {
  host = next;
}

/** Tell scripts a screen was drawn. */
export function emitScreen(screen: ScreenInfo, element: HTMLElement): void {
  current = screen;
  currentElement = element;
  for (const fn of [...listeners]) {
    try { fn(screen, element); } catch (err) { console.error('Veneer: a veneer.on("screen") handler failed:', err); }
  }
}

export interface ScriptResult {
  cleanup?: () => void;
  error?: string;
}

/** Run a screen's script. Errors are caught and reported, never thrown. */
export function runScreenScript(code: string, element: HTMLElement, label: string): ScriptResult {
  try {
    const fn = new Function('veneer', 'screen', code) as (v: VeneerApi, el: HTMLElement) => unknown;
    const out = fn(veneer, element);
    return typeof out === 'function' ? { cleanup: wrapCleanup(out as () => void, label) } : {};
  } catch (err) {
    console.error(`Veneer: the script for ${label} failed:`, err);
    return { error: (err as Error).message ?? String(err) };
  }
}

/**
 * Run global.js once, when the page loads. If a screen is already showing,
 * handlers it registers are called for that screen straight away.
 */
export function runSiteScript(code: string): ScriptResult {
  const before = new Set(listeners);
  try {
    new Function('veneer', code)(veneer);
    if (current && currentElement) {
      for (const fn of [...listeners].filter((l) => !before.has(l))) {
        try { fn(current, currentElement); } catch (err) { console.error('Veneer: a veneer.on("screen") handler failed:', err); }
      }
    }
    return {};
  } catch (err) {
    console.error('Veneer: global.js failed:', err);
    return { error: (err as Error).message ?? String(err) };
  }
}

function wrapCleanup(fn: () => void, label: string): () => void {
  return () => {
    try { fn(); } catch (err) { console.error(`Veneer: the cleanup for ${label} failed:`, err); }
  };
}
