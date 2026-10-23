# Veneer

Veneer renders IBM i 5250 green-screen applications as modern web pages without
changing host code. It runs on the IBM i (PASE) or on any other machine with Node.js 20+.

## Packages

| Package | Status | Purpose |
| --- | --- | --- |
| `packages/tn5250` | Milestone 1 | Pure TypeScript TN5250 client: Telnet/TLS, 5250 data stream, screen model |
| `packages/server` | Milestone 2 | Session server: one host session per browser tab over WebSocket |
| `packages/client` | Milestone 3 | Browser client: React UI with auto-transform rules |

## Development

```sh
npm install
npm test              # unit tests (node:test, runs TypeScript directly)
npm run build         # compile to dist/ for deployment
cp .env.example .env  # then set VENEER_HOST etc.
npm run cli           # interactive session against your IBM i
npm run demo          # fake IBM i + server + client on http://127.0.0.1:8080 (after npm run build)
                      # VENEER_DEMO_DELAY_MS=700 npm run demo simulates a slow host
npm run dev           # session server against your IBM i, restarts on change
npm run dev:client    # Vite dev server on :5173 with hot reload; proxies /ws to :8080
```

For production, run `npm run build` and then `npm start`. The server serves the built
client from `packages/client/dist`.

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
By default, IBM i names the devices (QPADEVxxxx). Set `VENEER_DEVNAME_PREFIX=VENEER` to
get VENEER001, VENEER002, … instead, so Veneer jobs are easy to spot in WRKACTJOB. Names
are reused when sessions end, and the number width fills the 10-character limit (up to
3 digits).

## Auto-transform

The client renders each screen through a rule pipeline (`packages/client/src/transform`).
Every item keeps its 5250 row and column, so any screen renders faithfully. Recognized
patterns are swapped for widgets:

| Pattern | Becomes |
| --- | --- |
| Row 1 title and identifiers | Page header |
| `F3=Exit  F12=Cancel` legend | Button bar (keyboard F-keys still work; Shift+F1–F12 = F13–F24) |
| Message line / error line | Info or error banner (Esc = Reset) |
| Subfile above `More...` / `Bottom` | Table; mouse wheel and PgUp/PgDn page it |
| `2=Change  4=Delete` legend | Dropdown in the option column |
| ` 1. User tasks` menu lines | Links that enter the option |
| `===>` command line | Command input |
| `User . . . . :` dot leaders | Clean labels |
| `.....` / `:` bordered pop-up window | Modal card over the dimmed screen; its F-keys and messages take over |

Rules run in order, and each one claims the cells it renders. Rules work on a region: the
whole screen, or the interior of the active pop-up window. Per-screen customizations
can later be added as extra rules. **Classic view** shows the untransformed screen.

## Type-ahead

As on a 5250, keys typed while the host is busy are not lost. They are queued (the header
shows "N typed ahead") and replayed into the next screen, starting at the host's cursor.
Full fields advance to the next field, and an AID key in the queue (Enter, F-keys, PgUp/PgDn)
submits; any keys after it wait for the following screen. A host error discards the queue.

## Field handling

The browser applies the same field rules as a 5250 terminal:

- **Numeric fields** (signed and numeric-only) right-align and accept only digits, signs,
  `.` and `,`. Digits-only fields accept only digits.
- **Negative numbers**: type `-` before or after the digits, or use keypad **−** (Field−).
  Keypad **+** (Field+) clears the sign. Both move to the next field. The value is sent
  as a 5250 does: right-adjusted, with the sign in the zone of the last digit.
- **Auto-enter** fields submit Enter as soon as they're full.
- **Mandatory entry** and **mandatory fill** fields are checked before Enter. A notice
  explains the problem, and the cursor goes back to the field.
- Upper-case (monocase) fields convert as you type. A full field advances to the next one.
