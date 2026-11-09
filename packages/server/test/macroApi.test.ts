// The macro API (#41): other systems run macros marked "api": true over
// HTTP, signed on as their own service profile, and get the screen the macro
// ends on: named values, fields, every page of its list, and messages.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, mock, test } from 'node:test';
import { parseApiClients } from '../src/apiClients.ts';
import { loadConfig, type ServerConfig } from '../src/config.ts';
import { log } from '../src/log.ts';
import { createServer, type VeneerServer } from '../src/server.ts';
import { DemoHost } from '../dev/demoHost.ts';

const DEMO_SCREENS = fileURLToPath(new URL('../dev/screens', import.meta.url));
const hash = (token: string) => `sha256:${createHash('sha256').update(token).digest('hex')}`;

let host: DemoHost;
let hostPort: number;
const servers: VeneerServer[] = [];

before(async () => {
  host = new DemoHost({ autoSignOn: true });
  hostPort = await host.listen();
});
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  mock.restoreAll();
});
after(() => host.server.close());

/** The demo's screens and macros, and a few more for these tests. */
function screensDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veneer-api-'));
  fs.cpSync(DEMO_SCREENS, dir, { recursive: true });
  const menu = JSON.parse(fs.readFileSync(path.join(dir, 'macros/active-jobs.json'), 'utf8')).steps[0];
  const write = (name: string, macro: object) => fs.writeFileSync(path.join(dir, 'macros', `${name}.json`), JSON.stringify({ name, label: name, ...macro }));
  write('not-for-api', { steps: [menu] });
  // Option 2 goes to Order Entry, not the Order Status screen it expects next.
  write('wrong-turn', { api: true, steps: [{ ...menu, fields: { '20:7': '2' } }, { screen: '005ae4fb0b6762', title: 'Order Status', press: 'Enter' }] });
  // Starts from a screen the demo never shows after signing on.
  write('never-starts', { api: true, timeout: 1, steps: [{ screen: '0123456789abcd', title: 'Somewhere Else', press: 'Enter' }] });
  return dir;
}

const CLIENTS = {
  erp: { token: hash('erp-token'), user: 'erpapi', passwordEnv: 'ERP_PASSWORD' },
  shop: { token: hash('shop-token'), user: 'SHOPAPI', passwordEnv: 'SHOP_PASSWORD', macros: ['order-status'], maxRuns: 1 },
  wrong: { token: hash('wrong-token'), user: 'WRONGPW', passwordEnv: 'WRONG_PASSWORD' },
};
const ENV = { ERP_PASSWORD: 'demo', SHOP_PASSWORD: 'demo', WRONG_PASSWORD: 'not-demo' };

async function start(extra: Partial<ServerConfig> = {}): Promise<{ url: string; server: VeneerServer }> {
  const server = createServer({
    listenHost: '127.0.0.1', listenPort: 0,
    host: { host: '127.0.0.1', port: hostPort, tls: false },
    idleTimeoutMs: 0, resumeGraceMs: 0, maxSessions: 10, allowedOrigins: [],
    screensDir: screensDir(),
    api: { clients: parseApiClients(CLIENTS, ENV, 'sha'), substitute: 'sha' },
    ...extra,
  });
  servers.push(server);
  return { url: `http://127.0.0.1:${(await server.listen()).port}`, server };
}

async function call(url: string, token: string | undefined, macro: string, body?: unknown, method = 'POST') {
  const res = await fetch(`${url}/api/run/${macro}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  return { status: res.status, headers: res.headers, body: (await res.json()) as Record<string, any> };
}

test('a macro runs signed on as the client\'s profile and returns the screen it ends on', async () => {
  const lines: Array<Record<string, unknown>> = [];
  mock.method(log, 'info', (msg: string, fields: Record<string, unknown> = {}) => lines.push({ msg, ...fields }));
  const { url, server } = await start();
  const r = await call(url, 'erp-token', 'order-status', { order: '104572' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.screen, { id: '005ae4fb0b6762', title: 'Order Status', definition: 'demo-order-status' });
  assert.deepEqual(r.body.values, { customer: 'Harbor Supply Co', status: 'DLV', ship_date: r.body.values.ship_date, amount: '000031840' });
  assert.match(r.body.values.ship_date, /^\d{8}$/);
  assert.deepEqual(r.body.fields, { '4:22': '104572' });
  assert.equal(r.body.list, null);
  assert.deepEqual(r.body.messages, []);
  assert.match(r.body.lines[5], /Customer . . . :  Harbor Supply Co/);
  // A number is taken as its digits; what the host says comes back in messages.
  const missing = await call(url, 'erp-token', 'order-status', { order: 999999 });
  assert.equal(missing.status, 200);
  assert.deepEqual(missing.body.messages, ['Order 999999 not found.']);

  // Logged with who ran what and how it went, never the values.
  const runs = lines.filter((l) => l.msg === 'api run');
  assert.deepEqual(runs.map((l) => [l.client, l.macro, l.outcome, l.status]), [['erp', 'order-status', 'done', 200], ['erp', 'order-status', 'done', 200]]);
  assert.ok(!JSON.stringify(lines).includes('104572') && !JSON.stringify(lines).includes('999999'));
  // The session and its device are given back.
  assert.equal(server.sessions.size, 0);
});

test('a list comes back whole, every page, rows by column heading', async () => {
  const { url } = await start();
  const r = await call(url, 'erp-token', 'active-jobs');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.list.columns, ['Subsystem/Job', 'User', 'Type', 'CPU %', 'Function', 'Status']);
  assert.equal(r.body.list.rows.length, 16, 'both pages of the demo\'s 16 jobs');
  assert.equal(r.body.list.complete, true);
  assert.deepEqual(r.body.list.rows[0], { 'Subsystem/Job': 'QBATCH', User: 'QSYS', Type: 'SBS', 'CPU %': '.0', Function: '', Status: 'DEQW' });
  assert.equal(r.body.list.rows[15]['Subsystem/Job'], 'ADMIN');
});

test('who may run what: a client token, a macro marked for the API, and the client\'s own list', async () => {
  const { url } = await start();
  const none = await call(url, undefined, 'order-status', {});
  assert.equal(none.status, 401);
  assert.match(none.headers.get('www-authenticate') ?? '', /^Bearer/);
  assert.equal((await call(url, 'designer-token', 'order-status', {})).status, 401);
  // Not marked for the API, not in the client's list, or not there: the same answer.
  const notApi = await call(url, 'erp-token', 'not-for-api', {});
  assert.equal(notApi.status, 404);
  assert.equal(notApi.body.error, 'There is no macro "not-for-api" for this client to run.');
  assert.equal((await call(url, 'shop-token', 'active-jobs', {})).status, 404);
  assert.equal((await call(url, 'erp-token', 'no-such-macro', {})).status, 404);
  assert.equal((await call(url, 'erp-token', 'order-status', undefined, 'GET')).status, 405);

  const list = await fetch(`${url}/api/run`, { headers: { Authorization: 'Bearer shop-token' } }).then((r) => r.json()) as { macros: Array<{ name: string }> };
  assert.deepEqual(list.macros.map((m) => m.name), ['order-status']);
  const spec = await fetch(`${url}/api/run/openapi.json`, { headers: { Authorization: 'Bearer erp-token' } }).then((r) => r.json()) as { openapi: string; paths: Record<string, any> };
  assert.equal(spec.openapi, '3.1.0');
  assert.deepEqual(Object.keys(spec.paths), ['/api/run/active-jobs', '/api/run/never-starts', '/api/run/order-status', '/api/run/wrong-turn']);
  const schema = spec.paths['/api/run/order-status'].post.requestBody.content['application/json'].schema;
  assert.deepEqual(schema.required, ['order']);
  assert.equal(schema.properties.order.pattern, '^(?:[0-9]{1,6})$');

  // Off without VENEER_API_CLIENTS.
  const { url: off } = await start({ api: undefined });
  assert.equal((await call(off, 'erp-token', 'order-status', {})).status, 403);
});

test('values are checked before signing on', async () => {
  const { url } = await start();
  const bad = async (body: unknown, message: RegExp, status = 422) => {
    const r = await call(url, 'erp-token', 'order-status', body);
    assert.equal(r.status, status, JSON.stringify(r.body));
    assert.match(r.body.error, message);
  };
  await bad({}, /needs order number/);
  await bad({ order: '12a' }, /“12a” is not a valid order number/);
  await bad({ order: '1', customer: 'x' }, /“customer” is not one of the macro's values/);
  await bad({ order: ['1'] }, /must be text or a number/);
  await bad('{"order": ', /not valid JSON/, 400);
  await bad('[]', /must be a JSON object/);
});

test('a macro that takes a wrong turn stops there: 409 with the step and the screen it stopped on', async () => {
  const { url } = await start();
  const r = await call(url, 'erp-token', 'wrong-turn', {});
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, 'Step 2 expected the “Order Status” screen.');
  assert.equal(r.body.step, 2);
  assert.equal(r.body.lastScreen.screen.title, 'New Order');

  const never = await call(url, 'erp-token', 'never-starts', {});
  assert.equal(never.status, 409);
  assert.equal(never.body.error, 'After signing on, the IBM i showed “Demo Main Menu” instead of “Somewhere Else”.');
});

test('a service profile the IBM i refuses stops the client\'s runs until restart, so it can\'t be disabled', async () => {
  const warned: string[] = [];
  mock.method(log, 'error', (msg: string) => warned.push(msg));
  const { url } = await start();
  const first = await call(url, 'wrong-token', 'order-status', { order: '1' });
  assert.equal(first.status, 502);
  assert.equal(first.body.error, 'Signing on as WRONGPW failed: The password is wrong.');
  assert.ok(warned.some((m) => /refused until Veneer restarts/.test(m)));
  const again = await call(url, 'wrong-token', 'order-status', { order: '1' });
  assert.equal(again.status, 502);
  assert.match(again.body.error, /stopped signing on as WRONGPW until it restarts/);
  // Other clients carry on.
  assert.equal((await call(url, 'erp-token', 'order-status', { order: '104571' })).status, 200);
});

test('limits: runs at once per client (429), and the server\'s sessions (503)', async () => {
  const { url } = await start();
  // shop may run one at a time; never-starts waits a second for its screen.
  const shopClients = { ...CLIENTS, shop: { ...CLIENTS.shop, macros: ['never-starts'] } };
  const { url: url2 } = await start({ api: { clients: parseApiClients(shopClients, ENV, 'sha'), substitute: 'sha' } });
  const slow = call(url2, 'shop-token', 'never-starts', {});
  await new Promise((r) => setTimeout(r, 100));
  const busy = await call(url2, 'shop-token', 'never-starts', {});
  assert.equal(busy.status, 429);
  assert.equal(busy.headers.get('retry-after'), '1');
  assert.equal((await slow).status, 409);

  const { url: full } = await start({ maxSessions: 0 });
  const r = await call(full, 'erp-token', 'order-status', { order: '1' });
  assert.equal(r.status, 503);
  assert.ok(r.headers.get('retry-after'));
  assert.ok(url);
});

test('the clients file: tokens as hashes, passwords in environment variables', () => {
  const ok = parseApiClients(CLIENTS, ENV, 'sha');
  assert.deepEqual(ok.map((c) => [c.name, c.user, c.maxRuns, c.macros ?? null]), [['erp', 'ERPAPI', 2, null], ['shop', 'SHOPAPI', 1, ['order-status']], ['wrong', 'WRONGPW', 2, null]]);
  const bad = (clients: unknown, message: RegExp, env: Record<string, string> = ENV) => assert.throws(() => parseApiClients(clients, env, 'sha'), message);
  bad({ erp: { ...CLIENTS.erp, password: 'demo' } }, /put the password in an environment variable/);
  bad({ erp: { ...CLIENTS.erp, token: 'erp-token' } }, /token must be "sha256:"/);
  bad({ erp: CLIENTS.erp, copy: { ...CLIENTS.shop, token: CLIENTS.erp.token } }, /same token as another client/);
  bad({ erp: CLIENTS.erp }, /ERP_PASSWORD \(its password\) is not set/, {});
  bad({ erp: { ...CLIENTS.erp, user: 'not a user' } }, /user must be an IBM i user profile/);
  bad({ erp: { ...CLIENTS.erp, maxRuns: 0 } }, /maxRuns must be a whole number from 1 to 20/);
  bad({ erp: { ...CLIENTS.erp, macros: [] } }, /macros must be a list/);
  bad({ ERP: CLIENTS.erp }, /lowercase letters/);
  bad({}, /lists no clients/);
  assert.throws(() => parseApiClients(CLIENTS, { ...ENV, ERP_PASSWORD: 'much-too-long' }, 'des'), /at most 10 characters/);

  // VENEER_API_CLIENTS needs the password level, for an IBM i.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veneer-api-config-'));
  const file = path.join(dir, 'clients.json');
  fs.writeFileSync(file, JSON.stringify({ erp: CLIENTS.erp }));
  const env = { VENEER_HOST: 'ibmi.example.com', VENEER_API_CLIENTS: file, ERP_PASSWORD: 'demo' };
  assert.throws(() => loadConfig(env), /needs VENEER_QPWDLVL/);
  assert.throws(() => loadConfig({ ...env, VENEER_QPWDLVL: '2', VENEER_HOST_TYPE: '3270' }), /is for IBM i hosts/);
  const config = loadConfig({ ...env, VENEER_QPWDLVL: '2' });
  assert.equal(config.api?.substitute, 'sha');
  assert.equal(config.api?.clients[0]?.user, 'ERPAPI');
  assert.equal(config.host.autoSignOn, undefined, 'users still sign on on the host\'s screen');
  assert.throws(() => loadConfig({ ...env, VENEER_QPWDLVL: '2', VENEER_API_CLIENTS: path.join(dir, 'missing.json') }), /can't read/);
});
