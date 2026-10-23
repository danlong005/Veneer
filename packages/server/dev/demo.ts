// npm run demo: the demo IBM i plus the Veneer server, on http://127.0.0.1:8080.

import { loadConfig } from '../src/config.ts';
import { log } from '../src/log.ts';
import { createServer } from '../src/server.ts';
import { DemoHost } from './demoHost.ts';

const hostPort = await new DemoHost().listen();
const config = loadConfig({ ...process.env, VENEER_HOST: '127.0.0.1', VENEER_PORT: String(hostPort), VENEER_TLS: 'false' });
const server = createServer(config);
const addr = await server.listen();
log.info('demo ready', { url: `http://${addr.address}:${addr.port}`, client: config.staticDir ?? 'not built (npm run build)' });
process.on('SIGINT', () => void server.close().then(() => process.exit(0)));
