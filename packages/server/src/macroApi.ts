// The macro API: other systems run installed macros over HTTP and get the
// screen they end on as JSON. Only macros marked "api": true, for clients
// listed in VENEER_API_CLIENTS (apiClients.ts), each with its own token and
// IBM i service profile.
//
//   GET  /api/run                 the macros this client may run
//   GET  /api/run/openapi.json    the same as an OpenAPI 3.1 description
//   POST /api/run/<macro>         {"order": "12345"} -> the screen it ends on
//
// Each run has a host session of its own (apiRun.ts); runs are logged with
// the client, macro and outcome, never the values given or read.

import type http from 'node:http';
import { DefinitionError, ID_PATTERN, MAX_PARAM_VALUE, apiValues, type Macro } from '@veneer/screens';
import type { HostType } from '@veneer/terminal';
import { json, readBody } from './api.ts';
import { clientFor, type ApiClient } from './apiClients.ts';
import { runMacro, type RunResult } from './apiRun.ts';
import type { ApiConfig } from './config.ts';
import { hostTypeOf, type HostSettings } from './host.ts';
import { log } from './log.ts';
import { traceRecord, type SessionManager } from './sessions.ts';
import type { ScreenStore } from './store.ts';
import { VERSION } from './version.ts';

export interface MacroApiOptions {
  api: ApiConfig;
  host: HostSettings;
  store: ScreenStore;
  sessions: SessionManager;
  trace?: boolean | undefined;
}

/** HTTP status for each way a run can end. */
const STATUS: Record<RunResult['outcome'], number> = { done: 200, stopped: 409, timeout: 504, signon: 502, host: 502 };

export class MacroApi {
  private readonly opts: MacroApiOptions;
  private readonly hostType: HostType;
  /** Runs under way, by client. */
  private readonly running = new Map<string, number>();
  /**
   * Clients whose service profile was refused (a wrong password, a disabled
   * profile): their runs stop here until Veneer restarts, so repeated calls
   * can't disable the profile.
   */
  private readonly refused = new Map<string, string>();

  constructor(opts: MacroApiOptions) {
    this.opts = opts;
    this.hostType = hostTypeOf(opts.host);
  }

  /** The macros a client may run: marked for the API, for this kind of host, and in its list if it has one. */
  macrosFor(client: ApiClient): Macro[] {
    return this.opts.store.listMacros()
      .filter((m) => m.api && (!m.host || m.host === this.hostType) && (!client.macros || client.macros.includes(m.name)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** For the admin page: each client, its runs under way, and whether it is stopped. */
  status(): Array<{ name: string; user: string; running: number; stopped: string | null }> {
    return this.opts.api.clients.map((c) => ({ name: c.name, user: c.user, running: this.running.get(c.name) ?? 0, stopped: this.refused.get(c.name) ?? null }));
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
    const client = clientFor(this.opts.api.clients, req.headers.authorization);
    if (!client) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="Veneer macro API"');
      return json(res, 401, { error: 'An API client token is required (Authorization: Bearer <token>)' });
    }
    if (pathname === '/api/run' || pathname === '/api/run/') {
      if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
      return json(res, 200, { macros: this.macrosFor(client).map(describe) });
    }
    if (pathname === '/api/run/openapi.json') {
      if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
      return json(res, 200, openApi(this.macrosFor(client)));
    }
    let name: string;
    try { name = decodeURIComponent(pathname.slice('/api/run/'.length)); } catch { name = ''; }
    if (!ID_PATTERN.test(name)) return json(res, 404, { error: 'Not found' });
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return json(res, 405, { error: 'Method not allowed: run a macro with POST' });
    }
    const macro = this.macrosFor(client).find((m) => m.name === name);
    // The same answer for a macro that doesn't exist and one this client can't run.
    if (!macro) return json(res, 404, { error: `There is no macro "${name}" for this client to run.` });

    let body: unknown;
    try {
      const text = await readBody(req);
      body = text.trim() === '' ? {} : JSON.parse(text);
    } catch (err) {
      return json(res, 400, { error: (err as Error).message.startsWith('Body') ? (err as Error).message : 'Body is not valid JSON' });
    }
    let values: Record<string, string>;
    try {
      values = apiValues(macro, body);
    } catch (err) {
      if (err instanceof DefinitionError) return json(res, 422, { error: err.message });
      throw err;
    }
    return this.run(client, macro, values, res);
  }

  private async run(client: ApiClient, macro: Macro, values: Record<string, string>, res: http.ServerResponse): Promise<void> {
    const fields = { client: client.name, macro: macro.name };
    const stopped = this.refused.get(client.name);
    if (stopped) {
      log.warn('api run refused', { ...fields, reason: 'service profile refused earlier' });
      return json(res, 502, { error: `${stopped} Veneer stopped signing on as ${client.user} until it restarts, so the profile isn't disabled.` });
    }
    const running = this.running.get(client.name) ?? 0;
    if (running >= client.maxRuns) {
      res.setHeader('Retry-After', '1');
      return json(res, 429, { error: `This client already has ${running} ${running === 1 ? 'run' : 'runs'} under way, its limit; try again when one finishes.` });
    }
    const lease = this.opts.sessions.lease();
    if ('refused' in lease) {
      res.setHeader('Retry-After', '5');
      return json(res, 503, { error: lease.refused });
    }
    this.running.set(client.name, running + 1);
    const started = Date.now();
    let result: RunResult;
    try {
      result = await runMacro({
        host: this.opts.host, lease, macro, values,
        signOn: { user: client.user, password: client.password, substitute: this.opts.api.substitute },
        definitions: () => this.opts.store.list(),
        trace: this.opts.trace ? (dir, rec) => traceRecord({ id: `api:${client.name}` }, dir, rec, this.hostType) : undefined,
      });
    } finally {
      lease.release();
      const now = (this.running.get(client.name) ?? 1) - 1;
      if (now > 0) this.running.set(client.name, now); else this.running.delete(client.name);
    }
    const status = STATUS[result.outcome];
    const step = 'step' in result && result.step ? { step: result.step } : {};
    log.info('api run', { ...fields, outcome: result.outcome, status, ms: Date.now() - started, ...step });
    if (result.outcome === 'done') return json(res, 200, result.result);
    if (result.outcome === 'signon') {
      if (result.refused) {
        this.refused.set(client.name, result.error);
        log.error('macro API client can\'t sign on; its runs are refused until Veneer restarts', { client: client.name, user: client.user, error: result.error });
      } else {
        log.warn('api sign-on failed', { client: client.name, user: client.user, error: result.error });
      }
    }
    if (result.outcome === 'host') log.warn('api run failed', { ...fields, error: result.error });
    return json(res, status, { error: result.error, ...step, ...('result' in result ? { lastScreen: result.result } : {}) });
  }
}

/** A macro as GET /api/run lists it. */
function describe(m: Macro) {
  return {
    name: m.name, label: m.label,
    params: Object.fromEntries(Object.entries(m.params ?? {}).map(([k, p]) => [k, { ...(p.label ? { label: p.label } : {}), required: p.required ?? false, ...(p.pattern ? { pattern: p.pattern } : {}) }])),
    output: Object.keys(m.output ?? {}),
  };
}

/** An OpenAPI 3.1 description of the macros a client may run. */
export function openApi(macros: readonly Macro[]): Record<string, unknown> {
  const errors = {
    400: 'The body is not a JSON object.',
    401: 'No token, or not a client\'s token.',
    404: 'No such macro for this client.',
    409: 'It stopped on a screen it didn\'t expect, a host error, or a value a field won\'t take. lastScreen is where it stopped.',
    422: 'A value is missing, unknown, or doesn\'t match its pattern.',
    429: 'The client has its limit of runs under way. Retry after the Retry-After seconds.',
    502: 'The service profile didn\'t sign on, or the connection to the IBM i failed.',
    503: 'Veneer has no free session or device name. Retry after the Retry-After seconds.',
    504: 'A screen didn\'t appear in time. lastScreen is where it waited.',
  };
  const paths: Record<string, unknown> = {};
  for (const m of macros) {
    const params = Object.entries(m.params ?? {});
    const required = params.filter(([, p]) => p.required).map(([k]) => k);
    const outputs = Object.keys(m.output ?? {});
    paths[`/api/run/${m.name}`] = {
      post: {
        operationId: m.name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase()),
        summary: m.label,
        requestBody: {
          required: required.length > 0,
          content: {
            'application/json': {
              schema: {
                type: 'object', additionalProperties: false,
                properties: Object.fromEntries(params.map(([k, p]) => [k, {
                  type: 'string', maxLength: MAX_PARAM_VALUE,
                  ...(p.label ? { description: p.label } : {}),
                  ...(p.pattern ? { pattern: `^(?:${p.pattern})$` } : {}),
                }])),
                ...(required.length ? { required } : {}),
              },
            },
          },
        },
        responses: {
          200: {
            description: 'It ran to the end: the screen it ended on.',
            content: {
              'application/json': {
                schema: outputs.length
                  ? { allOf: [{ $ref: '#/components/schemas/Screen' }, { type: 'object', properties: { values: { type: 'object', properties: Object.fromEntries(outputs.map((o) => [o, { type: 'string' }])), required: outputs } } }] }
                  : { $ref: '#/components/schemas/Screen' },
              },
            },
          },
          ...Object.fromEntries(Object.entries(errors).map(([code, description]) => [code, { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }])),
        },
      },
    };
  }
  const str = { type: 'string' };
  const screen = {
    type: 'object',
    required: ['screen', 'values', 'fields', 'list', 'messages', 'lines'],
    properties: {
      screen: { type: 'object', properties: { id: str, title: { type: ['string', 'null'] }, definition: { type: ['string', 'null'] } } },
      values: { type: 'object', additionalProperties: str, description: 'The values the macro names, read from the screen.' },
      fields: { type: 'object', additionalProperties: str, description: 'Every field by its position (row:col), except hidden ones.' },
      list: {
        oneOf: [{ type: 'null' }, {
          type: 'object', required: ['columns', 'rows', 'complete'],
          properties: {
            columns: { type: 'array', items: str },
            rows: { type: 'array', items: { type: 'object', additionalProperties: str }, description: 'Every page, by column heading.' },
            complete: { type: 'boolean', description: 'False when it stopped at the page limit.' },
          },
        }],
      },
      messages: { type: 'array', items: str },
      lines: { type: 'array', items: str, description: 'The screen\'s text, row by row.' },
    },
  };
  return {
    openapi: '3.1.0',
    info: { title: 'Veneer macro API', version: VERSION, description: 'Runs green-screen macros installed in Veneer. Each call signs on, runs the macro and returns the screen it ends on.' },
    paths,
    components: {
      securitySchemes: { token: { type: 'http', scheme: 'bearer' } },
      schemas: {
        Screen: screen,
        Error: { type: 'object', required: ['error'], properties: { error: str, step: { type: 'integer' }, lastScreen: { $ref: '#/components/schemas/Screen' } } },
      },
    },
    security: [{ token: [] }],
  };
}
