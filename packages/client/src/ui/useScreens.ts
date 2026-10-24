// Screen definitions from the server, refetched when the server reports a change.

import type { ScreenDefinition } from '@veneer/screens';
import { useCallback, useEffect, useState } from 'react';

export interface ScreensApi {
  screens: ScreenDefinition[];
  /** Whether the server allows saving from the designer. */
  designer: boolean;
  /** Whether saving needs the designer token (false for a browser on the server's machine in local mode). */
  tokenRequired: boolean;
  reload: () => void;
}

export function useScreens(version: number): ScreensApi {
  const [screens, setScreens] = useState<ScreenDefinition[]>([]);
  const [designer, setDesigner] = useState(false);
  const [tokenRequired, setTokenRequired] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetch('/api/config'), fetch('/api/screens')])
      .then(async ([config, list]) => {
        if (!config.ok || !list.ok) throw new Error(`HTTP ${config.status}/${list.status}`);
        const c = (await config.json()) as { designer: boolean; tokenRequired?: boolean };
        const l = (await list.json()) as { screens: ScreenDefinition[] };
        if (cancelled) return;
        setDesigner(c.designer);
        setTokenRequired(c.tokenRequired ?? true);
        setScreens(l.screens);
      })
      .catch((err: Error) => console.warn('Could not load screen definitions:', err.message));
    return () => { cancelled = true; };
  }, [version, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { screens, designer, tokenRequired, reload };
}
