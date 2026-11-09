// When each screen definition last applied to a screen a session showed,
// since the server started, so the admin page can list the ones that haven't:
// usually a display file recompiled with a new layout. Kept in memory only.

import { matchScreen, type ScreenDefinition } from '@veneer/screens';
import type { HostType, ScreenSnapshot } from '@veneer/terminal';

export interface DefinitionUse {
  id: string;
  name: string;
  /** When it last customized a screen since startup, or null. */
  lastMatched: string | null;
}

export class MatchLog {
  private readonly last = new Map<string, string>();
  private readonly definitions: () => readonly ScreenDefinition[];
  /** The server's kind of host: definitions for the other kind are left out. */
  private readonly host: HostType | undefined;

  constructor(definitions: () => readonly ScreenDefinition[], host?: HostType) {
    this.definitions = definitions;
    this.host = host;
  }

  /** A session is showing this screen (unlocked). */
  record(snap: ScreenSnapshot): void {
    const def = matchScreen(snap, this.definitions());
    if (def) this.last.set(def.id, new Date().toISOString());
  }

  /** Every installed definition for this kind of host: those that haven't matched first, then the least recently matched. */
  list(): DefinitionUse[] {
    return this.definitions()
      .filter((d) => !this.host || !d.host || d.host === this.host)
      .map((d) => ({ id: d.id, name: d.name, lastMatched: this.last.get(d.id) ?? null }))
      .sort((a, b) => (a.lastMatched ?? '').localeCompare(b.lastMatched ?? '') || a.id.localeCompare(b.id));
  }
}
