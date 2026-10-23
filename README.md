# Veneer

Veneer renders IBM i 5250 green-screen applications as modern web pages without
changing host code. It runs on the IBM i (PASE) or on any other machine with Node.js 20+.

## Packages

| Package | Status | Purpose |
| --- | --- | --- |
| `packages/tn5250` | Milestone 1 | Pure TypeScript TN5250 client: Telnet/TLS, 5250 data stream, screen model |
| `packages/server` | Milestone 2 | Session server: one host session per browser tab over WebSocket |
| `packages/client` | planned | Browser renderer with auto-transform rules |

## Development

```sh
npm install
npm test              # unit tests (node:test, runs TypeScript directly)
npm run build         # compile to dist/ for deployment
cp .env.example .env  # then set VENEER_HOST etc.
npm run cli           # interactive session against your IBM i
npm run dev           # session server on http://127.0.0.1:8080, restarts on change
```

In the CLI, `3=QSECOFR` stages a value for input field 3, and `enter`, `f3`, `pgdn`, etc.
send it. `VENEER_TRACE=traces/name.jsonl npm run cli` records every raw 5250 record
for building test fixtures. Traces contain everything typed, including passwords,
and `traces/` is git-ignored.

## Session server

Each browser WebSocket at `/ws` gets its own TN5250 session to the IBM i set in
`.env`. The browser cannot choose the host. Messages are JSON (see
`packages/server/src/protocol.ts`):

1. The client sends `{"type":"hello"}`, or `{"type":"hello","resumeToken":"..."}` after a reload.
2. The server replies with `hello` (session id + resume token), `status`, and then a `screen` each time the display changes.
3. The client sends `submit` (`aid`, changed `fields` by `"row:col"` id, optional `cursor`), `reset`, `sysreq`, `attn` or `disconnect`.

If a socket drops, its host session stays alive for `VENEER_RESUME_GRACE_SECONDS`
so a page reload can reattach. Sessions with no input for `VENEER_IDLE_TIMEOUT_MINUTES`
are ended. The server listens on 127.0.0.1 by default. Before exposing it on a
network, set `VENEER_HTTPS_CERT`/`VENEER_HTTPS_KEY` so sign-on passwords are encrypted.
The server leaves device naming to IBM i (QPADEVxxxx), because one fixed name
can't be shared between sessions.
