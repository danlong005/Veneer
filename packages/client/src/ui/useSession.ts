// WebSocket connection to the Veneer server, with resume after reloads and
// automatic reconnects after network drops.

import type { ClientMessage, PasswordRules, ServerMessage } from '@veneer/server';
import type { ScreenSnapshot } from '@veneer/terminal';
import { useCallback, useEffect, useRef, useState } from 'react';

export type ConnectionState = 'connecting' | 'connected' | 'closed';

export interface SessionApi {
  state: ConnectionState;
  screen: { seq: number; snap: ScreenSnapshot } | null;
  /** Who signed on, once the server knows (for a macro's {user}). */
  user: string | null;
  /** Why the session closed, when state is 'closed'. */
  closedReason: string | null;
  /** Latest transient error from the server. */
  error: { id: number; message: string } | null;
  /**
   * Automatic sign-on: Veneer's sign-on page shows while this is set, with
   * the error from the last try. `waiting` while a sign-on is under way.
   */
  signOn: { password: PasswordRules; error?: string; waiting: boolean } | null;
  /** Something to tell the user until they next press a key (e.g. why the host's sign-on screen shows). */
  notice: string | null;
  /** Bumped when the server reports changed screen definitions. */
  screensVersion: number;
  send: (msg: ClientMessage) => void;
  disconnect: () => void;
  newSession: () => void;
}

const TOKEN_KEY = 'veneer.resumeToken';
/** In the page URL, starts a new session instead of resuming (ui/App.tsx openSession). */
export const NEW_SESSION = 'new-session';
/** Close codes after which reconnecting would not help. */
const FINAL_CODES = new Set([1000, 1008, 4001, 4002, 4003, 4004, 4005]);
const MAX_RETRIES = 8;

function storage(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

export function useSession(): SessionApi {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [screen, setScreen] = useState<SessionApi['screen']>(null);
  const [user, setUser] = useState<string | null>(null);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [error, setError] = useState<SessionApi['error']>(null);
  const [signOn, setSignOn] = useState<SessionApi['signOn']>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [screensVersion, setScreensVersion] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const retries = useRef(0);
  const retryTimer = useRef<number | undefined>(undefined);

  const connect = useCallback((resume: boolean) => {
    window.clearTimeout(retryTimer.current);
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    wsRef.current = ws;
    setState('connecting');
    setClosedReason(null);
    // Set when the server says the session is over (shutdown, grace expired):
    // the socket close that follows is not a network drop to retry.
    let ended = false;

    ws.onopen = () => {
      const token = resume ? storage()?.getItem(TOKEN_KEY) : null;
      ws.send(JSON.stringify(token ? { type: 'hello', resumeToken: token } : { type: 'hello' }));
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data)) as ServerMessage;
      switch (msg.type) {
        case 'hello':
          retries.current = 0;
          storage()?.setItem(TOKEN_KEY, msg.resumeToken);
          break;
        case 'status':
          if (msg.state === 'closed') {
            ended = true;
            setState('closed');
            setClosedReason(msg.message ?? 'Session ended');
          } else {
            setState(msg.state);
          }
          break;
        case 'signon':
          // Also after signing off: the last screen goes with the host connection.
          setScreen(null);
          setUser(null);
          setSignOn({ password: msg.password, ...(msg.error ? { error: msg.error } : {}), waiting: false });
          break;
        case 'notice':
          setNotice(msg.message);
          break;
        case 'screen':
          setSignOn(null);
          setScreen({ seq: msg.seq, snap: msg.screen });
          setUser(msg.user ?? null);
          setState('connected');
          break;
        case 'error':
          setError({ id: Date.now(), message: msg.message });
          break;
        case 'screens':
          setScreensVersion(msg.version);
          break;
      }
    };
    ws.onclose = (event) => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      if (ended || FINAL_CODES.has(event.code) || retries.current >= MAX_RETRIES) {
        if (event.code !== 4004) storage()?.removeItem(TOKEN_KEY);
        setState('closed');
        setClosedReason((r) => r ?? (event.reason || 'Connection lost'));
        return;
      }
      const delay = Math.min(10_000, 500 * 2 ** retries.current++);
      setState('connecting');
      retryTimer.current = window.setTimeout(() => connect(true), delay);
    };
  }, []);

  useEffect(() => {
    // A tab opened for a new session may have copied this tab's resume token.
    // A macro's deep link (?macro=...) also starts a new session, from a known place.
    const query = new URLSearchParams(location.search);
    const fresh = query.has(NEW_SESSION) || query.has('macro');
    if (fresh) history.replaceState(history.state, '', location.pathname + location.hash);
    connect(!fresh);
    return () => {
      window.clearTimeout(retryTimer.current);
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
    };
  }, [connect]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
    if (msg.type === 'submit') setNotice(null);
    if (msg.type === 'signon') setSignOn((s) => (s ? { password: s.password, waiting: true } : s));
  }, []);

  const disconnect = useCallback(() => {
    send({ type: 'disconnect' });
    storage()?.removeItem(TOKEN_KEY);
  }, [send]);

  const newSession = useCallback(() => {
    storage()?.removeItem(TOKEN_KEY);
    setScreen(null);
    setSignOn(null);
    setNotice(null);
    retries.current = 0;
    connect(false);
  }, [connect]);

  return { state, screen, user, closedReason, error, signOn, notice, screensVersion, send, disconnect, newSession };
}
