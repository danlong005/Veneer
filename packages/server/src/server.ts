// HTTP(S) server: /ws for browser sessions, /healthz, and the static client.

import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { handleApi } from './api.ts';
import type { ServerConfig } from './config.ts';
import { ScreenInventory } from './inventory.ts';
import { log } from './log.ts';
import { SessionManager } from './sessions.ts';
import { serveStatic } from './static.ts';
import { ScreenStore } from './store.ts';
import { VERSION } from './version.ts';

const HEARTBEAT_MS = 30_000;
const MAX_MESSAGE_BYTES = 64 * 1024;

export interface VeneerServer {
  readonly http: http.Server;
  readonly sessions: SessionManager;
  readonly screens: ScreenStore;
  readonly inventory: ScreenInventory;
  /** Load screen definitions, then start listening. */
  listen(): Promise<AddressInfo>;
  close(): Promise<void>;
}

export function createServer(config: ServerConfig): VeneerServer {
  const inventory = new ScreenInventory(config.dataDir ? path.join(config.dataDir, 'inventory.json') : undefined);
  const sessions = new SessionManager({
    inventory,
    host: config.host,
    idleTimeoutMs: config.idleTimeoutMs,
    resumeGraceMs: config.resumeGraceMs,
    maxSessions: config.maxSessions,
    deviceNamePrefix: config.deviceNamePrefix,
  });
  const screens = new ScreenStore(config.screensDir);
  screens.on('changed', (version) => sessions.broadcast({ type: 'screens', version }));

  const info = () => ({
    version: VERSION,
    node: process.version,
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    ibmi: { host: config.host.host, port: config.host.port ?? (config.host.tls ? 992 : 23), tls: Boolean(config.host.tls) },
    https: Boolean(config.https),
    maxSessions: config.maxSessions,
    deviceNamePrefix: config.deviceNamePrefix ?? null,
  });

  const onRequest: http.RequestListener = (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    const pathname = new URL(req.url ?? '/', 'http://x').pathname;
    if (pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: VERSION, uptimeSeconds: Math.round(process.uptime()), sessions: sessions.size }));
    } else if (handleApi(req, res, pathname, {
      store: screens, inventory, sessions, info,
      designerToken: config.designerToken, designerLocal: config.designerLocal,
      adminToken: config.adminToken, adminLocal: config.adminLocal,
    })) {
      // handled
    } else if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
    } else if (config.staticDir) {
      serveStatic(config.staticDir, req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('No client configured (VENEER_STATIC_DIR)');
    }
  };

  const server = config.https
    ? https.createServer({ cert: config.https.cert, key: config.https.key }, onRequest)
    : http.createServer(onRequest);

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const alive = new WeakSet<WebSocket>();

  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url ?? '/', 'http://x').pathname;
    if (pathname !== '/ws') return void socket.destroy();
    if (!originAllowed(req, config.allowedOrigins)) {
      log.warn('rejected websocket origin', { origin: req.headers.origin });
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return void socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      alive.add(ws);
      ws.on('pong', () => alive.add(ws));
      sessions.accept(ws, req.socket.remoteAddress ?? 'unknown');
    });
  });

  // Terminate sockets that stop answering pings (sleeping laptops, dead proxies).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) { ws.terminate(); continue; }
      alive.delete(ws);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    http: server,
    sessions,
    screens,
    inventory,
    listen: async () => {
      await screens.load();
      await inventory.load();
      return listenOn();
    },
    close: () => new Promise((resolve) => {

      clearInterval(heartbeat);
      sessions.closeAll();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      server.close(() => void inventory.flush().then(() => resolve()));
      server.closeAllConnections?.();
    }),
  };

  function listenOn(): Promise<AddressInfo> {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.listenPort, config.listenHost, () => {
        server.off('error', reject);
        resolve(server.address() as AddressInfo);
      });
    });
  }
}

/** Browsers always send Origin on WebSocket upgrades; require it to match. */
function originAllowed(req: http.IncomingMessage, allowed: string[]): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // not a browser
  if (allowed.length > 0) return allowed.includes(origin);
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
