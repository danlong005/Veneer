// Entry point: npm run dev (from source) or npm start (built).

import { loadConfig } from './config.ts';
import { log } from './log.ts';
import { createServer } from './server.ts';

let config;
try {
  config = loadConfig();
} catch (err) {
  log.error('invalid configuration', { error: (err as Error).message });
  process.exit(1);
}

const server = createServer(config);
const addr = await server.listen();
log.info('veneer listening', {
  url: `${config.https ? 'https' : 'http'}://${addr.address}:${addr.port}`,
  ibmi: `${config.host.host}:${config.host.port ?? (config.host.tls ? 992 : 23)}`,
  tls: Boolean(config.host.tls),
});
if (!config.https && config.listenHost !== '127.0.0.1' && config.listenHost !== 'localhost') {
  log.warn('serving plain HTTP on a network interface; sign-on passwords cross the network unencrypted. Set VENEER_HTTPS_CERT/KEY.');
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    stopping = true;
    log.info('shutting down', { signal });
    void server.close().then(() => process.exit(0));
  });
}
