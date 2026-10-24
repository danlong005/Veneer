// Screen definitions from the server, refetched when the server reports a change.

import type { ScreenDefinition, SiteCustomization } from '@veneer/screens';
import { useCallback, useEffect, useState } from 'react';

export interface ScreensApi {
  screens: ScreenDefinition[];
  /** Site-wide CSS and JavaScript (global.css, global.js); null until loaded. */
  site: SiteCustomization | null;
  /** Whether the server allows saving from the designer. */
  designer: boolean;
  /** Whether saving needs the designer token (false for a browser on the server's machine in local mode). */
  tokenRequired: boolean;
  reload: () => void;
}

export function useScreens(version: number): ScreensApi {
  const [screens, setScreens] = useState<ScreenDefinition[]>([]);
  const [site, setSite] = useState<SiteCustomization | null>(null);
  const [designer, setDesigner] = useState(false);
  const [tokenRequired, setTokenRequired] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetch('/api/config'), fetch('/api/screens')])
      .then(async ([config, list]) => {
        if (!config.ok || !list.ok) throw new Error(`HTTP ${config.status}/${list.status}`);
        const c = (await config.json()) as { designer: boolean; tokenRequired?: boolean };
        const l = (await list.json()) as { screens: ScreenDefinition[]; site?: SiteCustomization };
        if (cancelled) return;
        setDesigner(c.designer);
        setTokenRequired(c.tokenRequired ?? true);
        setScreens(l.screens);
        setSite(l.site ?? { css: '', scripts: { load: '', screen: '' } });
      })
      .catch((err: Error) => console.warn('Could not load screen definitions:', err.message));
    return () => { cancelled = true; };
  }, [version, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { screens, site, designer, tokenRequired, reload };
}
