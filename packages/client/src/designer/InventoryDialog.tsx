// The screen inventory: every screen Veneer has shown, by screen ID, with how
// often people open it and whether it has a customization yet.

import type { ScreenDefinition } from '@veneer/screens';
import { useEffect, useMemo, useState } from 'react';

interface Entry {
  id: string;
  title: string | null;
  window: boolean;
  rows: number;
  cols: number;
  fields: number;
  visits: number;
  firstSeen: string;
  lastSeen: string;
}

type Sort = 'visits' | 'recent' | 'title';

interface Props {
  /** Authorization header value, when the server needs the designer token. */
  auth: string | undefined;
  definitions: ScreenDefinition[];
  /** The screen showing now. */
  currentId: string;
  onClose: () => void;
}

export function InventoryDialog({ auth, definitions, currentId, onClose }: Props) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [uncustomized, setUncustomized] = useState(false);
  const [sort, setSort] = useState<Sort>('visits');
  const [tick, setTick] = useState(0);

  const headers = useMemo(() => (auth ? { Authorization: auth } : undefined), [auth]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/inventory', headers ? { headers } : {})
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 401 ? 'Enter the designer token in the panel first.' : `HTTP ${res.status}`);
        return ((await res.json()) as { screens: Entry[] }).screens;
      })
      .then((s) => { if (!cancelled) setEntries(s); }, (err: Error) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [headers, tick]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Which customization (if any) is recognised by each screen ID.
  const customizedBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of definitions) for (const id of d.match.screenIds ?? []) m.set(id, d.name);
    return m;
  }, [definitions]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (entries ?? []).filter((e) =>
      (!uncustomized || !customizedBy.has(e.id))
      && (!q || (e.title ?? '').toLowerCase().includes(q) || e.id.includes(q)));
    const by: Record<Sort, (a: Entry, b: Entry) => number> = {
      visits: (a, b) => b.visits - a.visits,
      recent: (a, b) => b.lastSeen.localeCompare(a.lastSeen),
      title: (a, b) => (a.title ?? '￿').localeCompare(b.title ?? '￿'),
    };
    return list.sort(by[sort]);
  }, [entries, query, uncustomized, sort, customizedBy]);

  const total = entries?.length ?? 0;
  const done = entries?.filter((e) => customizedBy.has(e.id)).length ?? 0;

  const clear = async () => {
    if (!window.confirm('Clear the screen inventory? Veneer starts counting again from now.')) return;
    const res = await fetch('/api/inventory', { method: 'DELETE', ...(headers ? { headers } : {}) });
    if (res.ok) setTick((t) => t + 1);
    else setError(`Could not clear it (HTTP ${res.status}).`);
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="inventory-title" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog wide inventory">
        <header className="inv-head">
          <div>
            <h2 id="inventory-title">Screen inventory</h2>
            <p>
              Every screen Veneer has shown, by screen ID.
              {entries && ` ${done} of ${total} customized.`}
            </p>
          </div>
          <button type="button" className="ghost" onClick={onClose}>Close</button>
        </header>

        <div className="inv-tools">
          <input type="search" placeholder="Search title or ID" aria-label="Search screens" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="visits">Most visited</option>
            <option value="recent">Recently seen</option>
            <option value="title">Title</option>
          </select>
          <label className="dp-check">
            <input type="checkbox" checked={uncustomized} onChange={(e) => setUncustomized(e.target.checked)} /> Not customized yet
          </label>
        </div>

        {error && <p className="dp-warn" role="alert">{error}</p>}
        {!entries && !error && <p>Loading…</p>}
        {entries && (shown.length === 0 ? (
          <p className="inv-empty">{total === 0 ? 'No screens recorded yet. Screens are added as people use Veneer.' : 'No screens match.'}</p>
        ) : (
          <div className="inv-scroll">
            <table className="inv-table">
              <thead>
                <tr><th>Screen</th><th>Screen ID</th><th className="num">Fields</th><th className="num">Visits</th><th>Last seen</th><th>Customization</th></tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id} className={e.id === currentId ? 'current' : ''}>
                    <td>
                      {e.title ?? <span className="inv-muted">Untitled</span>}
                      {e.window && <span className="dp-tag inv-tag">pop-up</span>}
                      {e.id === currentId && <span className="dp-tag">this screen</span>}
                    </td>
                    <td><code>{e.id}</code></td>
                    <td className="num">{e.fields}</td>
                    <td className="num">{e.visits.toLocaleString()}</td>
                    <td title={new Date(e.lastSeen).toLocaleString()}>{ago(e.lastSeen)}</td>
                    <td>{customizedBy.get(e.id) ?? <span className="inv-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        <footer className="inv-foot">
          <span className="inv-muted">Open a screen in Veneer and use the designer to customize it.</span>
          <button type="button" className="ghost danger" disabled={!entries || total === 0} onClick={clear}>Clear inventory</button>
        </footer>
      </div>
    </div>
  );
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
