<p align="center">
  <img src="docs/brand/veneer-logo-900.png" alt="Veneer" width="560">
</p>

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
and on Linux (systemd), plus upgrades, rollback and log files. To run it in Docker instead,
`docker compose up --build` (see [Docker](deploy/README.md#docker)).

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
3 digits). If a name is already in use, for example by a job left over from before a
restart or by another emulator, IBM i first checks that the session holding it is still
alive, then asks for another name. Veneer offers the next free one (up to three more) and
skips the busy name for 10 minutes. The log records `device name in use` and the
`device assigned` to each session.

### Admin page

`/admin` shows who is connected and lets an operator fix stuck sessions without
restarting the server:

- **Active sessions**, refreshed every two seconds: the IBM i user (read from the sign-on
  screen once the host accepts it), device name, browser address, when it connected, last
  activity, and whether a browser is attached or the session is waiting for a page reload.
- **End** closes the host connection, which ends the IBM i job and frees the device. The
  user's browser shows that an administrator ended the session. Each end is logged.
- **Recent warnings and errors** (the last 200, kept in memory whatever `VENEER_LOG_LEVEL`
  is) and **server** facts: version, uptime, the IBM i host and whether TLS is on.

Access works like the designer but is separate from it. `VENEER_ADMIN=local` opens the
page to browsers on the server's own machine (`npm run dev` and `npm run demo` set it);
everyone else needs `VENEER_ADMIN_TOKEN`, which the page asks for once per tab. The
designer token never opens the admin page, and the two tokens must differ.

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
| Bordered pop-up window: the IBM i `.....` / `:` border, or any WDWBORDER characters or reverse-image border | Modal card over the dimmed screen; its F-keys and messages take over |

Rules run in order, and each one claims the cells it renders. Rules work on a region: the
whole screen, or the interior of the active pop-up window. Per-screen customizations
can later be added as extra rules. **Classic view** shows the untransformed screen.

## Exporting lists

Any screen with a list (a subfile) has an **Export** button in the key bar: **Excel (.xlsx)**
or **CSV**. Veneer pages up to the top of the list, then down to the bottom collecting every
row, then back to the page you were on. The option column is left out. In the Excel file,
numbers are numbers (`1,234.50-` becomes -1234.5), and codes with leading zeros such as
`00123` stay text. A progress window shows the pages read; **Cancel** (or Esc) stops and
returns you to your page. The Excel writer is built in, with no extra dependency.

## Type-ahead

As on a 5250, keys typed while the host is busy are not lost. They are queued (the header
shows "N typed ahead") and replayed into the next screen, starting at the host's cursor.
Full fields advance to the next field, and an AID key in the queue (Enter, F-keys, PgUp/PgDn)
submits; any keys after it wait for the following screen. A host error discards the queue.

## Field handling

The browser applies the same field rules as a 5250 terminal:

- **Numeric fields** right-align. Numeric-only fields accept digits, signs, `.` and `,`,
  and IBM i aligns the decimals using the job's decimal format. Signed numeric fields
  accept only digits and a sign, as on a terminal: the decimal point is implied by the
  field, so type `1250` for 12.50 (IBM i rejects a record with a `.` in a signed field).
  Digits-only fields accept only digits.
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
    { "op": "button", "label": "Back to menu", "action": { "aid": "F12" } },
    { "op": "button", "label": "Customer in CRM", "action": { "url": "https://crm.example.com/customers/{6:22}" } }
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
  - `button` adds an action button that presses a key, optionally filling fields first,
    or opens a web page in a new tab. In a `url`, `{6:22}` is replaced by the field starting
    at row 6, column 22 (including what the user has typed), or else the screen text there
    up to the next double space. `{6:22:10}` takes exactly 10 characters. Values are
    URL-encoded, and only `http://` and `https://` addresses with a fixed host name are
    allowed. In the designer, choose **Open URL** as the button's action. **Insert
    selected** adds the selected item's position, and a preview shows the address.
  - `title` replaces the page title.
  - `move` draws an item somewhere else: `{ "op": "move", "at": { "row": 6, "col": 4 }, "to": { "row": 6, "col": 44 } }`.
    In the designer, drag any item (a table moves as a whole), or select it and use the arrow
    keys. Drag the corner handle of an HTML box to resize it. Moving only changes the layout:
    the host still sees fields where it put them, and Tab follows the new order.
- **Designer:** a **Design** button appears when the designer is enabled. With
  `VENEER_DESIGNER=local`, browsers on the server's own machine use it without a token;
  `npm run dev` and `npm run demo` turn this on. For anyone else, set `VENEER_DESIGNER_TOKEN`,
  which the designer asks for once per tab. The two can be combined. The design panel has
  three tabs: **Site-wide** (CSS and JavaScript for every page), **Page** (this screen's
  customization: name, title, how it's recognised, buttons, CSS and JavaScript) and
  **Selected** (the item last clicked on the screen). Click any
  text, field or table to change it, and see the result immediately. New customizations
  are recognised by this screen's ID. To attach another variant, such as the empty list,
  open it, pick the existing customization in the panel, and click **Add this screen**.
  **Save** writes the JSON file, and every connected browser picks up the change at once.
  With neither setting, definitions are read-only.
- **Screen inventory:** the designer's **Screens** button lists every screen Veneer has
  shown, across all users, by screen ID: its title, input field count, how many times
  people opened it (paging and redraws don't count), when it was last seen, and which
  customization recognises it. Sort by most visited and tick **Not customized yet** to see
  which screens to customize next. Only the screen's shape is recorded, never what was on
  it. It is kept in `inventory.json` in `VENEER_DATA_DIR` (default `data/`, not in git).
- **Demo:** `npm run demo` includes a customized order-entry screen (main menu option 2).

### Custom HTML, CSS and JavaScript

Designers can add their own code where the built-in changes aren't enough:

| | Site-wide (in the screens folder) | Per page (in its definition) | Per HTML box |
| --- | --- | --- | --- |
| HTML | | `html` changes: a box at a row and column, `width` × `height` cells | `html` |
| CSS | `global.css`, on every page | `css`, while the screen is shown | `css`, scoped to the box |
| JavaScript | `global.js` on **page load** (once); `global-screen.js` on **every screen** | `scripts.load` when the screen **opens**; `scripts.show` on **every redraw** | `script`, on every redraw |

In the designer, the **Site-wide** and **Page** tabs each have a CSS box and an **Event**
picker over one JavaScript box (events that have a script are marked ●). Add HTML from the
Page tab's **HTML** section, or click an empty spot on the screen. Click an HTML box to edit
its HTML, CSS and JavaScript on the **Selected** tab.

```json
{ "op": "html", "at": { "row": 5, "col": 46 }, "width": 28, "height": 2,
  "html": "<button class=\"help\">Need help?</button>",
  "css": "button { font-weight: 600; }",
  "script": "element.querySelector('.help').onclick = () => veneer.press('F1');" }
```

A box's CSS is nested inside the box: plain declarations style the box, and rules like
`button { … }` style what's in it. "Opens" means arriving from a different screen;
"redraw" includes paging and error messages on the same screen.

Every script is the body of `function (veneer, screen, element)`. `screen` describes the
screen showing (`{ id, definition, rows, cols, lines, fields }`). `element` is the page
element holding the screen, or the box for an HTML box's script. Functions a script declares
(`function doMessage() { … }`) can be called from the HTML, as in `onclick="doMessage()"`, while
the script is active. A script may return a
function to undo what it set up: an "opens" script's runs when the screen closes, the
others' before the next redraw. `veneer` (also `window.veneer`) offers:

- `veneer.screen`: the screen showing.
- `veneer.on('screen', (screen, element) => …)`: called after each screen is drawn. It
  returns a function that unsubscribes.
- `veneer.getField('6:53')`, `veneer.setField('6:53', 'X')`: read a field, or type into it.
- `veneer.press('F3')`, `veneer.press('Enter', { '6:53': 'X' })`: press a key, optionally
  filling fields first.

The app root carries `data-screen="<definition id>"`, so site CSS can target one screen.
Scripts pause while designing; **Test script** runs the draft once. A changed page-load
script runs after a page reload.

**Custom code runs with the page's full rights**, like Veneer's own code: it can read
everything users type, passwords included. Give designer access only to people you'd
trust to change the site's code, and review definitions in git like code.

## License

[MIT](LICENSE) © 2026 Daniel Long
