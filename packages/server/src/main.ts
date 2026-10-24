// Entry point.
//   node packages/server/dist/main.js --config /path/to/veneer.env   (production)
//   npm start / npm run dev                                          (uses the repo's .env)
// VENEER_CONFIG can name the config file instead of --config.

import fs from 'node:fs';
import { loadConfig, type ServerConfig } from './config.ts';
import { configureLog, log } from './log.ts';
import { createServer } from './server.ts';
import { VERSION } from './version.ts';

function configPath(argv: string[]): string | undefined {
  const i = argv.indexOf('--config');
  if (i >= 0) return argv[i + 1];
  return argv.find((a) => a.startsWith('--config='))?.slice('--config='.length) ?? process.env.VENEER_CONFIG;
}

let config: ServerConfig;
try {
  const file = configPath(process.argv.slice(2));
  if (file) {
    if (!fs.existsSync(file)) throw new Error(`config file not found: ${file}`);
    // Values already in the environment win, as with node --env-file.
    process.loadEnvFile(file);
  }
  config = loadConfig();
  configureLog(config.log);
} catch (err) {
  log.error('invalid configuration', { error: (err as Error).message });
  process.exit(1);
}

const server = createServer(config);
let addr;
try {
  addr = await server.listen();
} catch (err) {
  log.error('could not start', { error: (err as Error).message, port: config.listenPort });
  process.exit(1);
}
log.info('veneer listening', {
  version: VERSION,
  node: process.version,
  url: `${config.https ? 'https' : 'http'}://${addr.address}:${addr.port}`,
  ibmi: `${config.host.host}:${config.host.port ?? (config.host.tls ? 992 : 23)}`,
  tls: Boolean(config.host.tls),
  screens: config.screensDir,
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
    // Ending host sessions releases their IBM i devices; don't wait forever.
    setTimeout(() => process.exit(1), 10_000).unref();
    void server.close().then(() => process.exit(0));
  });
}
