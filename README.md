# Veneer

Veneer renders IBM i 5250 green-screen applications as modern web pages without
changing host code. It runs on the IBM i (PASE) or on any other machine with Node.js 20+.

## Packages

| Package | Status | Purpose |
| --- | --- | --- |
| `packages/tn5250` | Milestone 1 | Pure TypeScript TN5250 client: Telnet/TLS, 5250 data stream, screen model |
| `packages/server` | Milestone 2 | Session server: one host session per browser tab over WebSocket |
| `packages/client` | Milestone 3 | Browser client: React UI with auto-transform rules and the designer |
| `packages/screens` | Milestone 4 | Screen definitions: identification, customizations, validation |

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
npm run package       # release/veneer-<version>.tar.gz for deployment
```

**Deploying:** `npm run package` builds a self-contained archive that runs on any machine with
Node.js 20.12 or later, with no `npm install` and no internet access. [deploy/README.md](deploy/README.md)
covers installing it as a service on IBM i (Service Commander, or `SBMJOB` started at IPL)
and on Linux (systemd), plus upgrades, rollback and log files.

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

## Screen customizations and the designer

Auto-transform handles every screen. For the screens people use most, a **screen
definition** goes further. Each definition is one JSON file in `screens/` (or
`VENEER_SCREENS_DIR`), so customizations are reviewed and versioned in git like code.

```json
{
  "id": "order-entry",
  "name": "Order entry",
  "match": { "screenIds": ["04e026716dd801"], "text": [] },
  "title": "New Order",
  "changes": [
    { "op": "text", "at": { "row": 6, "col": 4 }, "text": "Customer number" },
    { "op": "hide", "at": { "row": 7, "col": 30 } },
    { "op": "widget", "field": "7:22", "widget": { "type": "select", "options": [{ "value": "TX", "label": "Texas" }] } },
    { "op": "widget", "field": "10:22", "widget": { "type": "date", "format": "YYYYMMDD" } },
    { "op": "widget", "field": "11:22", "widget": { "type": "checkbox", "on": "Y", "off": "N" } },
    { "op": "button", "label": "Back to menu", "action": { "aid": "F12" } }
  ]
}
```

- **Screen IDs:** every screen has an ID, a hash of what stays the same when the data
  changes. That's the screen size, the input-field layout from the display file, and the
  title. Dates, records, messages and the system name are left out, so an ID is the same
  on every page of a list and on development and production machines. A subfile's
  column of option fields counts once, whatever the number of records. A pop-up window is
  identified by its own title and fields, whatever screen it opens over. Recompiling a
  display file with a different field layout changes the ID.
- **Matching:** a definition applies when the screen's ID is one of its `screenIds`
  (if it lists any) and all its `text` rules match. Text rules are optional; use them to
  tell apart screens that share a layout and title, or screens with no input fields.
  List several IDs for variants of one screen, such as a list with no records (which
  has no option fields). If several definitions match, one with a screen ID wins, then
  the one with the most text rules.
- **Changes:**
  - `hide` hides the item at a position.
  - `text` replaces an item's text.
  - `role` restyles text (`emphasis`, `muted`, `danger`, …).
  - `widget` turns a field into a dropdown, checkbox or date picker. Values are
    converted to and from the host's format.
  - `button` adds an action button that presses a key, optionally filling fields first.
  - `title` replaces the page title.
- **Designer:** a **Design** button appears when the designer is enabled. With
  `VENEER_DESIGNER=local`, browsers on the server's own machine use it without a token;
  `npm run dev` and `npm run demo` turn this on. For anyone else, set `VENEER_DESIGNER_TOKEN`,
  which the designer asks for once per tab. The two can be combined. Click any
  text, field or table to change it, and see the result immediately. New customizations
  are recognised by this screen's ID. To attach another variant, such as the empty list,
  open it, pick the existing customization in the panel, and click **Add this screen**.
  **Save** writes the JSON file, and every connected browser picks up the change at once.
  With neither setting, definitions are read-only.
- **Demo:** `npm run demo` includes a customized order-entry screen (main menu option 2).

## License

[MIT](LICENSE) © 2026 Daniel Long
