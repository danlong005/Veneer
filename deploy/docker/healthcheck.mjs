// Container health check: exit 0 if /healthz answers. Speaks HTTPS when
// Veneer does; the certificate isn't checked, since it is the container's own.

import http from 'node:http';
import https from 'node:https';

const tls = Boolean(process.env.VENEER_HTTPS_CERT);
const port = process.env.VENEER_LISTEN_PORT || 8080;
const get = tls ? https.get : http.get;

const req = get({ host: '127.0.0.1', port, path: '/healthz', timeout: 4000, rejectUnauthorized: false }, (res) => {
  res.resume();
  process.exit(res.statusCode === 200 ? 0 : 1);
});
req.on('timeout', () => req.destroy(new Error('timeout')));
req.on('error', () => process.exit(1));
