<p align="center">
  <img src="docs/brand/veneer-logo-900.png" alt="Veneer" width="560">
</p>

# Veneer

Veneer renders green-screen applications as modern web pages without changing host
code: IBM i 5250 applications, and IBM Z mainframe 3270 applications such as TSO and
ISPF on z/OS. Each server talks to one kind of host, chosen in its configuration; see
[Mainframe (3270) hosts](#mainframe-3270-hosts).

**Where it runs:** on any machine with Node.js 20.12 or later (Linux with systemd, Docker,
or a developer's PC), or on the host's own platform: in PASE on the IBM i (Service
Commander or `SBMJOB`), or on Linux on IBM Z, zCX or z/OS UNIX beside a mainframe (see
[Where to run Veneer for a mainframe](#where-to-run-veneer-for-a-mainframe)). Either way
it reaches the host over telnet, as an emulator does, and the host's applications are not
changed: no libraries or programs are added to QSYS. See [deploy/README.md](deploy/README.md).

**Security:** Veneer can be secured end to end. It connects to the host over TLS with the
certificate checked, serves browsers over HTTPS, runs as a low-authority service user,
and locks the designer and admin page behind tokens.
[Securing Veneer](deploy/README.md#securing-veneer) is the checklist for a production
install.

## Install

Veneer comes in two forms: a **release**, built and ready to run, and the **source**,
which has to be built before it runs. Look at what you have:

| What you have | Ready to run? | What to do |
| --- | --- | --- |
| `veneer-<version>.tar.gz` or `veneer-<version>.zip` from the [releases page](https://github.com/danlong005/Veneer/releases) | **Yes** | Unpack it on the IBM i, Linux server or PC and follow [deploy/README.md](deploy/README.md). The machine needs only Node.js 20.12 or later: no `npm install`, no build, no internet access. |
| Docker | Builds itself | From a clone of the repository: `cp .env.example .env`, set `VENEER_HOST`, then `docker compose up --build -d`. See [Docker](deploy/README.md#docker). |
| A `git clone` or a fork of this repository | **No** | Build it first. See [From a clone, fork or source download](deploy/README.md#from-a-clone-fork-or-source-download). |
| `veneer-<version>-src.tar.gz` or `-src.zip`, or GitHub's **Source code (zip)** / **Source code (tar.gz)** links | **No** | The same as a clone: build it first. |

**On an IBM i, use a release.** A clone, fork or source download can't run until it has
been built, and the build doesn't run in PASE: its browser bundler (Vite) has no IBM i
version. If you started from a fork, build a release from it on a PC or Linux machine
(`npm ci`, then `npm run package`) and copy the `.tar.gz` or `.zip` from its `release/`
folder to the IBM i, or download the release instead.

If you run a source checkout without building it, Veneer stops with "Veneer has not been
built", or Node.js reports `Cannot find module '.../packages/server/dist/main.js'`.

## Packages

| Package | Status | Purpose |
| --- | --- | --- |
| `packages/terminal` | 3270 stage 1 | The host-neutral model the other packages use: screens, fields, keys and the session interface |
| `packages/tn5250` | Milestone 1 | Pure TypeScript TN5250 client: Telnet/TLS, 5250 data stream, screen model |
| `packages/tn3270` | 3270 stage 2 | Pure TypeScript TN3270E/TN3270 client: Telnet/TLS, 3270 data stream, query replies, screen model |
| `packages/server` | Milestone 2 | Session server: one host session per browser tab over WebSocket |
| `packages/client` | Milestone 3 | Browser client: React UI with auto-transform rules and the designer |
| `packages/screens` | Milestone 4 | Screen definitions: identification, customizations, validation |
| `packages/view` | | How a screen is read: the transform rules, customizations applied, and reading a list across its pages (the browser and the macro API) |

## Development

Everything below runs from a clone of the repository on a development machine, not on
the IBM i (see [Install](#install)).

```sh
npm install
npm test              # unit tests (node:test, runs TypeScript directly)
npm run build         # compile to dist/ for deployment
cp .env.example .env  # then set VENEER_HOST etc.
npm run cli           # interactive session against your IBM i
npm run demo          # fake IBM i + server + client on http://127.0.0.1:8080 (after npm run build)
                      # VENEER_DEMO_DELAY_MS=700 npm run demo simulates a slow host
npm run demo -- --3270  # the same with a fake mainframe (3270); see "Mainframe (3270) hosts"
npm run dev           # session server against your IBM i, restarts on change
npm run dev:client    # Vite dev server on :5173 with hot reload; proxies /ws to :8080
npm run check:screens # check screen definitions and macros against recorded screens (see "Checking definitions in CI")
npm run demo:record   # record the demo's screens for the check, after changing a demo screen
npm run api:token     # a new macro API client token (see "Running macros from other systems")
npm run package       # release/veneer-<version>.tar.gz and .zip for deployment, plus -src.tar.gz and -src.zip (the source)
```

**HTTPS and TLS:** with the defaults, Veneer talks to the IBM i over TLS on port 992 and
serves plain HTTP on 127.0.0.1. To serve HTTPS locally too, make a `localhost` certificate
with mkcert and set `VENEER_HTTPS_CERT`/`VENEER_HTTPS_KEY` in `.env`. [TLS and HTTPS](deploy/README.md#tls-and-https)
has the steps, and covers trusting an IBM i's own certificate.

**No IBM i of your own?** [PUB400](https://pub400.com) is a free public one, and
[docs/pub400.md](docs/pub400.md) shows how to point Veneer at it.

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

Each browser WebSocket at `/ws` gets its own host session to the host set in
`.env`: TN5250 to an IBM i, or TN3270 to a mainframe (see [Mainframe (3270)
hosts](#mainframe-3270-hosts)). The browser cannot choose the host. Messages are JSON (see
`packages/server/src/protocol.ts`):

1. The client sends `{"type":"hello"}`, or `{"type":"hello","resumeToken":"..."}` after a reload.
2. The server replies with `hello` (session id + resume token), `status`, and then a `screen` each time the display changes.
   With [automatic sign-on](#automatic-sign-on) it first sends `signon`, and the client answers with `signon` (user,
   password, and optionally program, menu and library) before the host session starts.
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

### Automatic sign-on

With `VENEER_SIGNON=auto`, Veneer signs users on to the IBM i itself, so they never see
its sign-on screen: a new session shows Veneer's own sign-on page, in the site's theme
under its logo and name, and the user lands straight on their initial menu or program.
**More options** on the page sets the program, menu and current library to start with,
as on the IBM i's screen. A [deep link](#macros-and-deep-links) opened before signing
on shows the page, then runs its macro.

It uses IBM i Telnet's automatic sign-on (RFC 4777), so nothing is installed on the IBM
i. The password goes from the browser to Veneer once and is turned into a *password
substitute* (encrypted with random seeds from the IBM i and Veneer), which is all the IBM
i gets. It is never logged or kept. Two settings are needed:

| Setting | Meaning |
| --- | --- |
| `VENEER_SIGNON` | `auto` for Veneer's sign-on page; blank (or `host`) shows the IBM i's sign-on screen. IBM i only. |
| `VENEER_QPWDLVL` | The IBM i's `QPWDLVL` system value (`DSPSYSVAL QPWDLVL`): `0` or `1` (passwords of up to 10 characters, not case-sensitive, checked with DES) or `2` or `3` (up to 128, case-sensitive, checked with SHA-1). Telnet doesn't say which the IBM i uses, so Veneer must be told. |

On the IBM i, the `QRMTSIGN` system value must be `*VERIFY` or `*SAMEPRF`. If the IBM i
turns automatic sign-on down (`*FRCSIGNON` or `*REJECT`), Veneer logs `automatic
sign-on is not allowed` once with the fix, shows that user the IBM i's own sign-on
screen, and does the same for every session until it is restarted.

What the user sees when signing on doesn't work:

- **A wrong password, an unknown user or a disabled profile:** the reason, on Veneer's
  page, to try again. Each failure counts against the profile as usual (`QMAXSIGN`).
  After two failures from one browser address, each further try waits, starting at 2
  seconds and doubling up to a minute, until 15 minutes pass without a failure.
- **An expired password:** the IBM i's sign-on screen, with a note to sign on there,
  which goes on to its Change Password screen as on a terminal.

Veneer's page takes a password only on HTTPS, or from a browser on the server's own
machine; elsewhere it says to use the https:// address. New sessions (System ▸ New
session, or a deep link in another tab) ask for the password again: Veneer doesn't keep
it. Signing on with a Windows login (Kerberos) isn't supported.

To try it, run `VENEER_SIGNON=auto npm run demo`: the demo IBM i signs on any user with
the password `demo` (`expired` shows an expired password; the user `DISABLED`, a
disabled profile).

### Mainframe (3270) hosts

Veneer connects to 3270 hosts, shows their screens and has a 3270 keyboard. It has been
tested against MVS 3.8j (TK4-, on the Hercules emulator, over plain TN3270): VTAM and TSO
logon, TSO's line mode, full-screen tools, models 2 and 5, colour, PF and PA keys and
Clear. [docs/tk4.md](docs/tk4.md) shows how to set that up.

It has also been tested against z/OS (ISPF 8.1, on IBM Z Xplore, over TN3270E without
TLS): logon and reconnect, TSO line mode, ISPF panels, action bars, pull-downs and
pop-up windows, the data set list, View, the Command Shell, Attention, Clear, PA2 and
System Request. TLS to a mainframe, requesting LU names, CICS, IMS and code pages other
than 37 have only been tested against Veneer's own demo mainframe.
[docs/zxplore.md](docs/zxplore.md) shows how to set that up.

Each server talks to one kind of host. For a mainframe, set `VENEER_HOST_TYPE=3270`:

| Setting | 3270 meaning |
| --- | --- |
| `VENEER_HOST`, `VENEER_PORT`, `VENEER_TLS*` | The host's TN3270 server, as for an IBM i (992 with TLS, 23 without). |
| `VENEER_TERMINAL_TYPE` | `IBM-3278-2-E` (24x80, the default), `-3-E` (32x80), `-4-E` (43x80) or `-5-E` (27x132). |
| `VENEER_DEVNAME_PREFIX` | LU names `PREFIX01`, `PREFIX02`, … (prefix 1-6 characters). The host's TN3270 server must define them. Blank lets the host pick an LU. |
| `VENEER_TN3270E` | `false` uses plain TN3270 even if the host offers TN3270E (default: TN3270E when offered). |
| `VENEER_CCSID` | The host code page: `37` (default, US/Canada), `273` (Germany/Austria) or `1047` (z/OS Latin-1). Also works for 5250. |
| `VENEER_PAGE_KEYS` | What Page Up and Page Down send: `PF7,PF8` (the default, the usual convention), two other keys such as `PF19,PF20`, or `off`. |

On a 3270 the browser works like this:

| Key | Does |
| --- | --- |
| F1-F12, Shift+F1-F12 | PF1-PF24. Screens' "PF3=Exit" legends become buttons too. |
| Page Up, Page Down | The keys in `VENEER_PAGE_KEYS` (PF7 and PF8). |
| Pause | Clear: blanks the screen and tells the host. |
| End | Erase EOF: blanks the field from the caret to its end. |
| Insert | Switches between typing over (the default, as on a 3270: host screens are full of pre-filled fields) and inserting; **Insert** shows while inserting. |
| Esc | Reset: unlocks the keyboard if the host left it locked. |
| **Keys** menu | Every PF key, PA1-PA3, Clear, Erase Input (blanks every input field), Erase EOF and Insert. |
| **System** menu | System Request (needs TN3270E with the SYSREQ function; it switches to the system session and back) and Attention. |

While the host is working, the status shows **X SYSTEM**. Numeric fields take digits,
a decimal point and a minus sign, as a 3270's numeric lock does; mandatory entry and
mandatory fill are checked before Enter. Screens without fields, such as a logon screen
or the blank screen after Clear, have one input at the cursor: type a command there and
press Enter. TSO's line mode (`READY`, command output, `***` pauses) shows as on a
terminal: its output as text in a fixed-width font, with one input after the prompt.
When TSO fills the screen and erases it to carry on (after `***`), the earlier output
stays above the screen to scroll back to, up to 2000 lines, until a full-screen program
such as ISPF takes over.
Classic view shows every screen exactly as the host defines it, including TSO's output
lines as the input fields TSO makes them. The 27x132 screen of a model 5 fits windows about 1000 pixels wide and
scrolls sideways in narrower ones. There is no Help key, Field+/Field- or Record
Backspace on a 3270, and in the designer button keys are named PF1 to PF24, PA1 to PA3
and Clear.

Known limits on 3270:

- **Display terminals only:** no 3270 printers (SCS or LU 1), no DBCS (double-byte
  character sets), and no graphics (GDDM, programmed symbols).
- **Code pages 37, 273 and 1047** only.
- **TSO scrollback is kept only in the browser tab:** reloading the page, or starting a
  full-screen program, starts it again.
- **Lists need a selection column to be found.** A list in an ISPF-like tool (such as
  RFE's data set list) becomes a table, with Export and a narrow selection column, when
  it has a heading row in its own colour over three or more rows with the same input
  fields. A list without input fields, such as browse output, stays text.
- **A dropped connection can leave the user logged on.** When Veneer ends a session (an
  idle timeout, or a tab closed for longer than `VENEER_RESUME_GRACE_SECONDS`), the host
  sees the terminal go away. z/OS can reconnect a TSO user; MVS 3.8j can't, so log off
  before closing the tab ([docs/tk4.md](docs/tk4.md)).

To try it without a mainframe, run `npm run demo -- --3270` (or set
`VENEER_HOST_TYPE=3270` for `npm run demo`). The demo mainframe has a logon screen
(press Enter), a sign-on (any user ID), and a menu with a customer inquiry, an update
form and an order list. Its update form and order list come with screen definitions
(radio buttons, a spinner, and buttons for PA2 and PF7/PF8). With
`VENEER_TERMINAL_TYPE=IBM-3278-5-E` the order list uses the 27x132 screen, and with
`VENEER_TN3270E=false` the logon is a plain 3270 screen instead of TN3270E's SSCP-LU
text. System Request works there too (TN3270E only): type LOGOFF to end the session.
`VENEER_DEMO_DELAY_MS=1500` makes it slow, to see X SYSTEM.

A 3270 screen never gets the same screen id as a 5250 screen, so definitions made for
one host type never match the other. The designer records the host type in new
definitions (`"host": "3270"`), and then only lets them use keys that host has: PA1 to
PA3 on a 3270, Help, Print, Page Up/Down and Record Backspace on a 5250. Definitions
without `host` match either.

#### Where to run Veneer for a mainframe

z/OS has no equivalent of the IBM i's PASE, which runs AIX programs. Veneer only needs
Node.js 20.12 or later and a network path to the host's TN3270 server, so it can run in
any of these places:

| Where | How | Notes |
| --- | --- | --- |
| **Off the mainframe** (Linux or Docker on any server) | The Linux or Docker install in [deploy/README.md](deploy/README.md), with `VENEER_HOST` set to the TN3270 server. | The usual place for a 3270 front-end: nothing is installed on z/OS. Use TLS to the host (`VENEER_TLS=true`, port 992). This is how Veneer has been tested. |
| **Linux on IBM Z** (an LPAR or a z/VM guest) | The same Linux install. Node.js publishes builds for s390x. | Ordinary Linux; the network path to z/OS can stay inside the machine (HiperSockets). Not yet tried. |
| **zCX** (z/OS Container Extensions) | The Docker image, built for s390x: `docker buildx build --platform linux/s390x -t veneer .` (its base image, `node:22-alpine`, is published for s390x). | Runs Linux containers inside z/OS. Not yet tried. |
| **z/OS UNIX System Services** | Unpack the release archive and run it with IBM's Node.js for z/OS (IBM Open Enterprise SDK for Node.js). | USS is UNIX, but not AIX or Linux: it runs only programs built for z/OS, and its files are EBCDIC unless tagged. Veneer is plain JavaScript with no native modules, so it should run, but this is untested ([#33](https://github.com/danlong005/Veneer/issues/33)). |

### Admin page

`/admin` shows who is connected and lets an operator fix stuck sessions without
restarting the server:

- **Active sessions**, refreshed every two seconds: the IBM i user (read from the sign-on
  screen once the host accepts it, or known from the start with automatic sign-on), device name, browser address, when it connected, last
  activity, and whether a browser is attached or the session is waiting for a page reload.
- **End** closes the host connection, which ends the IBM i job and frees the device. The
  user's browser shows that an administrator ended the session. Each end is logged.
- **Recent warnings and errors** (the last 200, kept in memory whatever `VENEER_LOG_LEVEL`
  is) and **server** facts: version, uptime, the IBM i host and whether TLS is on.
- **Customizations:** each screen definition and when it last customized a screen since
  the server started, those not used yet first. One that stays unused while people work
  is usually for a screen whose layout changed. [Checking definitions in CI](#checking-definitions-in-ci)
  finds these before they reach users.

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

## Help

The **Help** button at the end of the key bar presses the 5250 Help key for the field you
are in. F1 is not used: applications may give it their own meaning, so it goes to the host
as F1. Veneer reads the help the host shows, a pop-up window or a full screen, and shows its
text in a popover next to the field, while your screen stays as it was. **More** (or Page
Down) shows the next page of long help. Closing the popover (×, or Esc) closes the help on
the host (F12, then F3 if needed), and what you had typed is still there. If the host has no
help for the screen, its message shows as usual. In the classic view, Help shows the host's
help screens as they are.

## Several sessions and System Request

Each browser tab is its own session, and a reload resumes the tab's session. **System ▸
New session** in the header opens another one in a new tab. The **System** menu also sends
**System Request**, **Attention**, and **Transfer to secondary job**: SysReq, then option 1 on
the System Request line or menu, once it appears (other screens the host shows first, such
as Display Program Messages, are passed over).

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

## Macros and deep links

A **macro** replays the steps to reach a screen: on each screen it expects, it types
into fields and presses a key, through the same checks as a user (field rules,
mandatory fields). A **deep link** starts one from a web address, so an intranet page,
an email or a CRM record can link straight to a screen, with values such as an order
number filled in.

```
https://veneer.example.com/?macro=order-inquiry&order=12345
```

A macro starts in three ways:

- **A deep link** opens a new session in that tab. The user signs on as usual (on
  Veneer's page with [automatic sign-on](#automatic-sign-on)), and the macro starts when
  its first screen appears (normally the initial menu).
- **A button** on a customized screen (the designer's Buttons section, **Run macro**)
  runs it from that screen. Its values can come from the screen: `{6:22}` is the field or
  text at row 6, column 22, including what the user typed.
- **Go to** in the page header lists the macros marked for it, and asks for any values
  they need.

A button or Go to starts at the first step whose screen is showing, so a macro that goes
Main menu → Orders → Order inquiry also works from the Orders menu. If a different
screen appears, the host shows an error, or a screen doesn't come within 30 seconds,
the macro stops and leaves the user on that screen with a note saying which step
stopped. Esc stops a running macro. Steps marked **only sometimes** (such as Display
Program Messages) are skipped when their screen doesn't appear.

### Recording and editing

With the designer enabled, **Macros** in the page header opens the Macros panel beside
the screen. Choose **Record**, go to the screen from where the macro should start, and
choose **Stop**: each key you pressed is a step, with what you typed. Passwords are
never recorded. Then:

- **Make value** turns a typed value into one the macro is given when it starts
  (`{order}`), with a name people see, whether it's required, and the values allowed (a
  regular expression, such as `[0-9]{1,9}`). `{user}` is the signed-on user.
- Change typed values or keys, mark steps **only sometimes**, reorder or delete them.
- **Test** runs the macro from the screen you are on, with values you type.
- The panel shows the deep link; **List under Go to** adds the macro to the menu.

Saving needs the designer token, as for screen definitions. Each macro is saved as
`macros/<name>.json` in the screens folder, so it is versioned in git with the
definitions:

```json
{
  "name": "order-inquiry",
  "label": "Order inquiry",
  "host": "5250",
  "params": { "order": { "label": "order number", "required": true, "pattern": "[0-9]{1,9}" } },
  "steps": [
    { "screen": "0a1b2c3d4e5f60", "title": "Main Menu", "fields": { "20:7": "11" }, "press": "Enter" },
    { "screen": "8f9e0d1c2b3a49", "title": "Order Inquiry", "fields": { "4:30": "{order}" }, "press": "Enter" }
  ],
  "menu": true
}
```

A step can also have `"optional": true`, `"cursor": {"row": 5, "col": 2}` (for keys
such as F4 that depend on where the cursor is), and `"text"` rules as in screen
definitions, for screens that share an ID. `"timeout"` (seconds) changes how long each
step waits.

### Checking what a macro sees

A macro can check what screens show, which makes it a test of a green-screen
application: run it after a change to a program, and it fails if the screen it ends on
is wrong. There are two places for checks, both edited in the macro's file for now:

- **`expect` on a step** is checked when that step's screen appears, before anything is
  typed. A failed check stops the run there, so the macro never types into a screen
  that isn't what it should be.
- **`end`** is the screen the macro must end on, after its last key: the screen ID it
  must have (`screen`, with `text` rules for screens that share an ID), and its checks
  (`expect`). Every end check is made, and the run fails if any of them fails.

```json
{
  "name": "order-delivered",
  "label": "Order is delivered",
  "params": { "order": { "required": true } },
  "steps": [
    { "screen": "1cb4b4c7237e07", "title": "Demo Main Menu", "fields": { "20:7": "15" }, "press": "Enter",
      "expect": [{ "at": "20:7", "equals": "" }] },
    { "screen": "005ae4fb0b6762", "title": "Order Status", "fields": { "4:22": "{order}" }, "press": "Enter" }
  ],
  "end": {
    "screen": "005ae4fb0b6762", "title": "Order Status",
    "expect": [
      { "at": "7:22", "equals": "DLV", "label": "Status" },
      { "at": "6:22", "contains": "Harbor" },
      { "message": true, "contains": "not found", "not": true }
    ]
  }
}
```

Each check reads one thing and tests it one way:

| | |
| --- | --- |
| `"at": "7:22"` | A field's value (what is typed in it), or the text at that position up to the next wide gap, as in `output`. A hidden field (a password) always reads as blank. |
| `"message": true` | The host's message: the message line (a window's, when one is open) and any error. |
| `"equals"` | The whole value is this; `""` means blank. |
| `"contains"` | The value has this in it. |
| `"matches"` | The whole value matches this regular expression, such as `"\\d{8}"`. |
| `"not": true` | The check passes when the test fails: the message doesn't contain "not found". |
| `"label"` | What results call it: "Status equals “DLV”" rather than "The value at 7:22 equals “DLV”". |

Values are compared without leading and trailing blanks, and case matters. A host error
after the last key fails the run, unless `end` checks the message: then the error is
what the test expects ("Order 999999 not found.").

**Where results show:**

- **In the browser** (**Test** in the Macros panel, a button or Go to), a run that
  fails a check stops with the reason: "Order is delivered stopped: At the end: Status
  equals “DLV”, but it is “SHP”." One that passes says "all 4 checks passed".
- **Through the [macro API](#running-macros-from-other-systems),** the result has
  `checks`: every check made, in order, with what the screen showed. A failed check
  returns 409, with `checks` and `lastScreen`:

  ```json
  {
    "error": "At the end: Status equals “DLV”, but it is “SHP”.",
    "checks": [
      { "step": 1, "check": "The value at 20:7 is blank", "passed": true, "actual": "" },
      { "check": "It ends on “Order Status”", "passed": true, "actual": "005ae4fb0b6762" },
      { "check": "Status equals “DLV”", "passed": false, "actual": "SHP" },
      { "check": "The value at 6:22 contains “Harbor”", "passed": true, "actual": "Harbor Supply Co" },
      { "check": "The message doesn't contain “not found”", "passed": true, "actual": "" }
    ],
    "lastScreen": { "...": "..." }
  }
  ```

  A `step` says which step's screen a check was made on; end checks have none.
- **In CI,** `npm run check:screens` checks the screen in `end` against the recorded
  screens, as it does each step's (see [Checking definitions in CI](#checking-definitions-in-ci)).

### Security

- A macro a user runs runs as that user, with their authority. It never signs on and
  never holds a password. (Through the [macro API](#running-macros-from-other-systems),
  it runs as the calling system's own service profile.)
- Only installed macros run: a deep link names a macro, it can't supply steps. Values
  only go into the fields the macro names; each is checked against its pattern before
  the first key, and against the field (length, numeric) before it is typed.
- Each run is logged (`macro run`: macro, user, outcome, the step it stopped at), never
  with its values.

Steps recognise screens by screen ID. If a display file is recompiled and a screen's ID
changes, macros through it stop at that step; the designer's screen inventory (**Screens**)
shows which macros use each screen.

### Running macros from other systems

The **macro API** lets other systems (an ERP, a web shop, a script) use green-screen
applications over HTTP, with no host code written: Veneer signs on, runs an installed
macro and returns the screen it ends on as JSON.

```sh
curl -H 'Authorization: Bearer <token>' -d '{"order": "104572"}' \
  https://veneer.example.com/api/run/order-status
```

```json
{
  "screen": { "id": "005ae4fb0b6762", "title": "Order Status", "definition": "demo-order-status" },
  "values": { "customer": "Harbor Supply Co", "status": "DLV", "ship_date": "20261106", "amount": "000031840" },
  "fields": { "4:22": "104572" },
  "list": null,
  "messages": [],
  "lines": [" ORD300                           Order Status", "..."]
}
```

- **`values`**: what the macro names under `output`, read from the last screen: a field,
  or the text at a position, up to the next wide gap. In the Macros panel, tick **Other
  systems can run it** and add them under **API results**.
- **`fields`**: every field by position, except hidden ones such as passwords.
- **`list`**: when the screen has a list, every page of it (Veneer pages through as
  Export does, up to 100 pages), as rows by column heading:
  `{"columns": ["Job", "User", ...], "rows": [{"Job": "QBATCH", "User": "QSYS", ...}], "complete": true}`.
- **`messages`**: the host's message line and any error. A macro that runs to the end
  returns 200 even if the host says "Order not found", so check `messages`.

Only macros with `"api": true` can be run this way, and only by the clients listed in the
file `VENEER_API_CLIENTS` names. Each client has its own token, and its runs sign on as
its own IBM i **service profile**, so the IBM i's authority, auditing and job logs apply
to it:

```json
{
  "erp": {
    "token": "sha256:0e3a2597eba540652f467da51d95983ffe6d8db20e106fb5fd9a6cc6c0c08d9f",
    "user": "VENEERAPI",
    "passwordEnv": "VENEER_API_ERP_PASSWORD",
    "macros": ["order-status"],
    "maxRuns": 2
  }
}
```

| Setting | Meaning |
| --- | --- |
| `token` | The SHA-256 of the client's token. `npm run api:token` (in a release, `node packages/server/dist/apiToken.js`) makes a token and prints this line. Veneer keeps only the hash. |
| `user` | The IBM i user profile its runs sign on as. Give it only the authority those macros need. |
| `passwordEnv` | The environment variable holding that profile's password: passwords are never in the file or a request. |
| `macros` | The macros it may run. Left out: every macro marked for the API. |
| `maxRuns` | Runs it may have under way at once (default 2, at most 20); more get 429. |

The macro API signs on with [automatic sign-on](#automatic-sign-on), so it needs IBM i,
`QRMTSIGN` set to `*VERIFY` or `*SAMEPRF`, and `VENEER_QPWDLVL`, whether or not users
sign on that way (`VENEER_SIGNON`).

**How a run goes.** Each call gets a session of its own: Veneer connects, signs on,
waits for the macro's first screen (past screens such as Display Program Messages, if
the macro marks them **only sometimes**), runs the steps with the same checks as a
user's run, reads the last screen and its list, and closes the session, which ends the
IBM i job. A run counts toward `VENEER_MAX_SESSIONS` and takes a device name from
`VENEER_DEVNAME_PREFIX`, like a browser session. In the demo it takes about 50 ms.

| Status | When |
| --- | --- |
| 200 | It ran to the end. |
| 400 | The body isn't a JSON object. |
| 401 | No token, or not a client's. |
| 404 | No such macro for this client, including one not marked for the API. |
| 409 | It stopped: a screen it didn't expect, a host error, or a value a field won't take. `step` says which step, `lastScreen` is where it stopped. |
| 422 | A value is missing, isn't one of the macro's, or doesn't match its pattern. Checked before signing on. |
| 429 | The client has `maxRuns` runs under way (`Retry-After`). |
| 502 | The service profile didn't sign on, or the connection to the IBM i failed. |
| 503 | Veneer is at its session limit or has no free device name (`Retry-After`). |
| 504 | A screen didn't appear within the macro's `timeout` (default 30 seconds). |

Errors are `{"error": "Step 2 expected the “Order Status” screen.", "step": 2, "lastScreen": {...}}`.
If the IBM i turns the service profile down (a wrong or expired password, a disabled
profile), Veneer stops signing on as it until it restarts, so repeated calls can't
disable the profile, and logs why.

`GET /api/run` lists the macros a client may run, with their values, and
`GET /api/run/openapi.json` describes them as OpenAPI 3.1 for code generators and API
tools. Each run is logged (`api run`: client, macro, outcome, HTTP status, time, the
step it stopped at), never with its values. The admin page's status (`/api/admin/status`)
lists the clients, their runs under way and any stopped client.

To try it, run `npm run demo` and call the demo's `order-status` or `active-jobs` macro
with the token `demo-api-token`:

```sh
curl -H 'Authorization: Bearer demo-api-token' -d '{"order": "104572"}' http://127.0.0.1:8080/api/run/order-status
curl -H 'Authorization: Bearer demo-api-token' -X POST http://127.0.0.1:8080/api/run/active-jobs
```

## Screen customizations and the designer

Auto-transform handles every screen. For the screens people use most, a **screen
definition** goes further. **[The designer guide](docs/designer.md)** shows how to open the
designer and make each kind of change, step by step; this section describes the files. Each definition is one JSON file in `screens/` (or
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
    { "op": "button", "label": "Customer in CRM", "action": { "url": "https://crm.example.com/customers/{6:22}" } },
    { "op": "style", "when": { "column": "Status", "equals": "MSGW" }, "role": "danger", "target": "row" }
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
- **Host type:** `"host": "5250"` or `"3270"` limits a definition to screens from that
  kind of host and the keys it has. The designer fills it in; without it a definition
  matches either.
- **Changes:**
  - `hide` hides the item at a position.
  - `text` replaces an item's text.
  - `role` restyles text (`emphasis`, `muted`, `danger`, …).
  - `widget` shows a field as a dropdown, checkbox, switch, date or time picker, radio
    buttons, spinner, text area, masked input or lookup. Values are converted to and from
    the host's format, so the host sees the same fields and values as on a terminal. See
    [Field widgets](#field-widgets).
  - `display` shows output text, or a list column, as a status badge, a formatted number
    or date, yes or no, a link, a progress bar or a barcode. See [Output text](#output-text).
  - `label` and `image` add text and pictures to the page. See [Labels and images](#labels-and-images).
  - `button` adds an action button that presses a key, optionally filling fields first,
    or opens a web page in a new tab. In a `url`, `{6:22}` is replaced by the field starting
    at row 6, column 22 (including what the user has typed), or else the screen text there
    up to the next double space. `{6:22:10}` takes exactly 10 characters. Values are
    URL-encoded, and only `http://` and `https://` addresses with a fixed host name are
    allowed. In the designer, choose **Open URL** as the button's action. **Insert
    selected** adds the selected item's position, and a preview shows the address. A
    button can also run a macro: `{ "macro": "order-inquiry", "params": { "order": "{6:22}" } }`
    (**Run macro**; see [Macros and deep links](#macros-and-deep-links)).
  - `style` restyles what matches a condition. `when` checks either a list column by its
    heading (`"column": "Status"`), with `target` set to `row` or `cell`, or the text or
    field at a position (`"at": { "row": 4, "col": 20 }`), with `target` set to `item`. The test is one
    of `equals`, `contains` or `matches` (a regular expression), all ignoring case, or
    `lessThan` or `greaterThan` for numbers. Numbers are read as screens show them
    (`12.50-`, `-12,50`, `1,234.50`). In the designer, the **Styles** section shows how
    many rows each rule matches on the current screen. A cell rule wins over a row rule.
  - `title` replaces the page title. The rest of the title row (program name, system
    name) appears in the page header. `hide`, `text`, `role` and `style` work on those items
    by their position on row 1. In the designer, click them in the header bar.
  - `move` draws an item somewhere else: `{ "op": "move", "at": { "row": 6, "col": 4 }, "to": { "row": 6, "col": 44 } }`.
    In the designer, drag any item (a table moves as a whole), or select it and use the arrow
    keys. Drag the corner handle of an HTML box to resize it. Moving only changes the layout:
    the host still sees fields where it put them, and Tab follows the new order.
  - `card` draws a framed panel, with an optional title on its border, around the cells
    from `from` to `to`: `{ "op": "card", "from": { "row": 5, "col": 2 }, "to": { "row": 9, "col": 60 }, "title": "Customer" }`.
    In the designer, select an item and click **Add card around this**, then drag the
    card's corner to resize it.
  - `tabs` splits rows into tabs, each a band of rows following the one before:
    `{ "op": "tabs", "tabs": [{ "title": "General", "from": 5, "to": 12 }, { "title": "Shipping", "from": 13, "to": 20 }] }`.
    One band shows at a time under a strip of tab titles, and the rows below move up.
    Fields on hidden tabs keep their values and are still sent. When the host puts the
    cursor on a hidden tab, or Veneer finds a problem in a field there, that tab opens.
    Cards and tabs use the positions where items are drawn, after moves. A card cannot be
    split between tabs. Tabs are not used while a pop-up window is shown. In the designer,
    select something on a row and click **Start a tab at row …** on the Page tab.
- **Designer:** a **Design** button appears when the designer is enabled. With
  `VENEER_DESIGNER=local`, browsers on the server's own machine use it without a token;
  `npm run dev` and `npm run demo` turn this on. For anyone else, set `VENEER_DESIGNER_TOKEN`,
  which the designer asks for once per tab. The two can be combined; for an installed
  server, see [Getting into the designer](deploy/README.md#getting-into-the-designer),
  with examples for a token and for an SSH tunnel. The design panel has
  four tabs: **Site-wide** (CSS and JavaScript for every page), **Themes** (the look of every
  page: [Themes](#themes)), **Page** (this screen's
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
- **Demo:** `npm run demo` has a customized screen for every widget, output display and
  ready-made component (main menu options 1 to 4, 7 and 11 to 18), and serves the example
  components, ready to place from the designer. The [widgets guide](docs/widgets.md#try-them-in-the-demo)
  and [components guide](docs/components.md#try-them-in-the-demo) say which option shows which. `npm run demo -- --3270`
  runs a demo mainframe instead ([Mainframe (3270) hosts](#mainframe-3270-hosts)).

### Checking definitions in CI

Recompiling a display file with a different field layout changes its screen ID. The
definitions and macros that name the old ID then stop applying, and nothing says so:
users just get the plain screen again. `veneer check` catches this before release by
testing the screens folder against **recorded screens**, copies of the screens kept in git
beside the definitions.

**Record screens** in the designer: open the screen, then click **Record for checks** on
the Page tab. It writes `snapshots/<definition id>.json` in the screens folder when the
screen has a saved customization (else `snapshots/screen-<screen ID>.json`). Record the
screens macros pass through the same way. A recording keeps the screen's text and field
layout, but never what was typed into input fields. It does keep the data shown on the
screen, such as customer names in a list, so record on a test system or with test data.
Click it again after a display file changes to replace the recording, then commit both.

**Run the check:**

```sh
npm run check:screens                          # from the repository: ./screens or VENEER_SCREENS_DIR
npm run check:screens -- path/to/screens
node packages/server/dist/check.js /path/to/screens   # from an installed release
```

It reports, by file:

- **Errors** (exit code 1): files that aren't valid JSON or valid definitions or macros, or
  whose name doesn't match their `id`/`name`. A definition that no longer matches the screen
  recorded for it, with the reason (*its screen ID is now …, not …*, or which text rule
  failed), or one taken over by a closer-matching definition. Widgets, components and
  buttons naming input fields that aren't on the recorded screen. Buttons running macros
  that don't exist, or not giving them their required values. Macro steps whose screen was
  recorded again with a new ID, fields they type into that are gone, and fixed values too
  long for their field.
- **Warnings** (exit code 0, or 1 with `--strict`): definitions and macro steps with no
  recorded screen to check, and hidden, recolored or moved items or style-rule columns
  with nothing on the recorded screen where they point. Positions can be blank just
  because the recording had no data there, so these are only warnings.

`--format github` writes GitHub Actions annotations, so problems show on the pull request's
files; it is the default when run in GitHub Actions. `--format json` is for other tools.

An example workflow for a repository holding the screens folder, which downloads a Veneer
release to run the check:

```yaml
# .github/workflows/veneer-check.yml
name: Veneer check
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - name: Download Veneer
        run: |
          VERSION=0.4.0   # a release with check.js (after 0.3.1)
          curl -fsSL "https://github.com/danlong005/Veneer/releases/download/v$VERSION/veneer-$VERSION.tar.gz" | tar -xz
          mv "veneer-$VERSION" "$RUNNER_TEMP/veneer"
      - run: node "$RUNNER_TEMP/veneer/packages/server/dist/check.js" screens
```

The admin page shows the same thing from live use: **Customizations** lists each
definition and when a screen last matched it since the server started (see
[Admin page](#admin-page)).

### Field widgets

In the designer, select an input field and pick **Show as**. In a definition, a `widget`
change names the field by its id (`"row:col"`). [docs/widgets.md](docs/widgets.md) is the
full guide to every widget: how to add it, each setting, and what users see and do.

| Show as | `widget` | Settings |
| --- | --- | --- |
| Dropdown | `{ "type": "select", "options": [{ "value": "TX", "label": "Texas" }] }` | `value` is sent to the host, `label` is shown |
| Checkbox | `{ "type": "checkbox", "on": "Y", "off": "N" }` | The values for checked and unchecked |
| Switch | `{ "type": "toggle", "on": "Y", "off": "N" }` | As a checkbox, drawn as an on/off switch |
| Date picker | `{ "type": "date", "format": "YYYYMMDD" }` | The host's date format |
| Time picker | `{ "type": "time", "format": "HHMMSS" }` | The host's time format: `HHMMSS`, `HHMM`, `HH:MM:SS`, `HH:MM`, `HH.MM.SS` or `HH.MM` |
| Radio buttons | `{ "type": "radio", "options": [{ "value": "A", "label": "Air" }], "layout": "row" }` | As a dropdown; `layout` `row` (side by side, the default) or `column`; `allowClear` |
| Spinner | `{ "type": "spinner", "min": 0, "max": 999, "step": 1 }` | All optional; `step` defaults to 1 |
| Text area | `{ "type": "textarea", "fields": ["14:10", "15:10", "16:10", "17:10"] }` | The fields, one per line, starting with the widget's own |
| Masked input | `{ "type": "mask", "mask": "(999) 999-9999" }` | `9` a digit, `A` a letter, `X` any character, the rest separators; `literals: true` when the host field holds the separators |
| Lookup | `{ "type": "lookup", "options": [{ "value": "TX", "label": "Texas" }], "prompt": { "aid": "F4" } }` | Suggestions while typing, and a button that presses `prompt` (such as F4, the host's prompt) in the field; at least one of the two |

- **Dropdowns and radio buttons:** a value that matches no choice shows nothing chosen and
  is kept as it is until the user picks one. In the designer, type the choices one per
  line as `value=Label`. For radio buttons, `"allowClear": true` adds a **None** choice
  that clears the field (it is sent as blanks). Arrow keys move between the choices and
  Tab goes on to the next field. In a `column` layout each choice takes a row, so leave
  room below the field or move what is there.
- **Spinner:** a number with up and down buttons; the Up and Down arrow keys step it too.
  It stays between `min` and `max` and follows the field's rules, so what it sends is what
  typing the number would send. Signed numeric fields have their decimals implied, so
  count in the units typed: on a field holding 12.50 as `1250`, a `step` of 100 is one
  whole. Numeric-only fields keep the decimals typed (`12.50` steps to `13.50`). The
  designer offers it for numeric fields only.
- **Text area:** several input fields, such as comment lines 1 to 4, edited as one box
  drawn over their rows. Each field is a line. Text that runs past a field's length wraps
  to the next line at a space, pushing that line along; Enter starts a new line. Typing
  stops when there is no room left, and a count beside the box shows how much is left.
  Each field still gets its own part, with its own rules (an upper-case field converts as
  you type), and only the lines that changed are sent. When the host puts the cursor or an
  error on one of the fields, the box takes focus with the caret on that line. Enter in
  the box starts a line rather than pressing Enter; use the **Enter** button or another
  key to send the screen. In the designer, select the first field, choose **Show as: Text
  area**, then click **Add the fields below** (the input fields in the same column and of
  the same length on the following rows), or **Pick fields on the screen** and click the
  fields to add or take out. Fields in a list (a subfile) can't be joined into a text area.
- **Masked input:** the user types only the characters; separators appear by themselves,
  and a full mask moves on to the next field. Characters a slot won't take are ignored.
- **Lookup:** any value can still be typed. The look-up button sends its key with the
  cursor in the field, as pressing it there would.

### Output text

A `display` change shows text the host put on the screen differently, at a position or for
every row of a list column. The text is only read; nothing sent to the host changes, and
text a display can't read shows as it is. In the designer, select the text and pick **Show
as**, or select a list and pick a **Column**. See [docs/widgets.md](docs/widgets.md#output-text).

```json
{ "op": "display", "column": "Status", "display": { "type": "badge", "values": [{ "value": "MSGW", "label": "Waiting for reply", "role": "danger" }] } }
```

| Show as | `display` | Settings |
| --- | --- | --- |
| Status badge | `{ "type": "badge", "values": [{ "value": "RUN", "label": "Running", "role": "accent" }], "otherwise": "muted" }` | Codes with a label and a color; `otherwise` colors the rest |
| Number | `{ "type": "number", "implied": 2, "decimals": 2, "currency": "USD" }` | All optional: decimals the host leaves out, decimals shown, a currency code |
| Date | `{ "type": "date", "format": "YYYYMMDD", "style": "medium" }` | The host's format; `short`, `medium` or `long` |
| Yes or no | `{ "type": "yesno", "yes": "Y", "no": "N" }` | The two values, shown as ✓ Yes and ✗ No |
| Link | `{ "type": "link", "to": "url", "url": "https://crm.example.com/c/{value}" }` | `email`, `phone` or `url`; `{value}` is the text |
| Progress bar | `{ "type": "progress", "max": 100 }` | The number that fills the bar |
| Barcode | `{ "type": "barcode", "format": "qr", "height": 4 }` | `qr` or `code128`, and the rows it covers |

### Labels and images

`label` adds text, with a style and optional help behind an ⓘ; `image` adds a picture from
the theme in use (by file name), a web address or a path on the site, which can take values
from the screen (`/products/{6:12}.jpg`). In the designer, use the Page tab's **Labels and
images** section, or click an empty spot. See [docs/widgets.md](docs/widgets.md#labels-and-images).

```json
{ "op": "label", "at": { "row": 4, "col": 4 }, "text": "Shipping", "style": "heading", "help": "Where and how the order is sent." }
{ "op": "image", "at": { "row": 2, "col": 60 }, "src": "banner.png", "alt": "Acme Supply", "width": 18, "height": 4 }
```

### Themes

A theme is how every page looks, for everyone: a style sheet plus artwork (a logo and any
other images), made in the designer by whoever customizes the screens. One theme is in use at a
time; others stay saved, so you can prepare a new look and switch over when it's ready.

Themes are kept in the screens folder, so they go into git and from development to production
with the screen definitions:

```
screens/themes/acme/theme.css    the style sheet
screens/themes/acme/logo.svg     images; one named logo.* replaces the header logo and tab icon
screens/themes/active.json       {"theme": "acme"}: the theme in use
```

**Built-in themes:** **Default** (Veneer's own look, used until you pick another), **Compact**
(dense, for power users), **Flat** (accent-colored header, square corners, no shadows),
**Green screen** (the 5250 palette, always dark), **Soft** (larger, rounded, a floating key
bar) and **High contrast** (black on white, or white on black in dark mode, with strong borders
and focus rings). They come with Veneer and can't be changed, but each can be copied to start
your own. Their style sheets are in `packages/server/themes/` and make good examples.

**Make your company's theme:**

1. Open the designer and its **Themes** tab. Pick a theme to see the screen in it.
2. Under **New theme**, give your theme a name (letters, digits, `-` and `_`) and click
   **Make a copy**. It copies the theme you picked, style sheet and images.
3. Edit the **Style sheet**. The screen shows your changes as you type, and **Undo** and
   **Redo** step through them. Most themes only set CSS variables: open **CSS variables** and
   click **Insert** to add one to the `:root` rule with an example value, then change the value.
4. Under **Artwork**, add your logo (`logo.svg` or `logo.png`) and any other images: PNG, SVG,
   JPEG, WebP or GIF, up to 1 MB each. Use an image in the style sheet by its name, such as
   `background: url(banner.png)`.
5. Click **Save theme**, then **Use for everyone**. Every user's page switches to it from their
   next screen, without reloading. Host sessions aren't affected.

A short theme for a company in red:

```css
:root {
  --brand-accent: #c8102e;
  --header-bg: #7a0019;
  --header-text: #ffffff;
  --header-muted: #f3c6cd;
  --header-border: transparent;
  --radius: 4px;
}
@media (prefers-color-scheme: dark) {
  :root { --header-bg: #3d000c; }
}
```

A theme's style sheet is loaded after Veneer's own styles and before `global.css` and screen
CSS, so those can still adjust it. It can set its own dark-mode values with
`@media (prefers-color-scheme: dark)`, or be always light or always dark (Green screen sets
`color-scheme: dark`). Anything beyond the variables is ordinary CSS; to beat one of Veneer's
own rules, prefix your selector with `:root`, as the built-in themes do. Scripts and components
can read the theme in use from `<html data-theme="acme">`. Screen customizations are the same
in every theme.

**CSS variables:**

| Variable | Sets | Example |
| --- | --- | --- |
| `--brand-accent` | Accent color: buttons, links, focus and highlights | `#c8102e` |
| `--brand-accent-dark` | Accent color in dark mode (default: a lighter --brand-accent) | `#ff6b81` |
| `--bg` | Page background | `#f4f5f7` |
| `--surface` | The screen and panels | `#ffffff` |
| `--surface-2` | Raised and hovered areas, list stripes | `#f8f9fb` |
| `--border` | Borders and dividers | `#e2e5ea` |
| `--text` | Text | `#1d232b` |
| `--text-strong` | Headings and emphasis | `#0b1017` |
| `--text-muted` | Labels and secondary text | `#5c6673` |
| `--header-bg` | Page header background | `#0b3d91` |
| `--header-text` | Page header text | `#ffffff` |
| `--header-muted` | Page header secondary text | `#c9d6ee` |
| `--header-border` | Line under the page header | `transparent` |
| `--accent-2` | Second accent (designer highlights, accent2 role) | `#a1349b` |
| `--danger` | Errors and the danger role | `#c62828` |
| `--warning` | Warnings and the warning role | `#a15c00` |
| `--radius-small` | Corners of buttons and fields | `6px` |
| `--radius` | Corners of panels and menus | `8px` |
| `--radius-large` | Corners of the screen | `12px` |
| `--shadow` | Shadow under the screen and dialogs | `none` |
| `--rh` | Height of a screen row (spacing) | `1.9em` |
| `--cw` | Width of a screen column | `0.64em` |
| `--font` | Text font | `"Segoe UI", system-ui, sans-serif` |
| `--mono` | Fixed-width font (classic view, code) | `Consolas, monospace` |

Rename and delete themes from the Themes tab (the theme in use can't be deleted: use another
for everyone first). Editing themes needs the designer token, like the rest of the designer.

**Upgrading:** before themes, the designer's Site-wide tab had a **Style** section, saved as
`global.style.json`. The first time a newer Veneer starts, it turns a saved style into a theme
named `site` (the chosen look's style sheet with the chosen accent, corners, density and font),
and uses it for everyone, so nothing changes for users. The old file is left in place and no
longer read; delete it when you like.

**Security:** a theme's CSS is trusted like `global.css`, since designers can already write
site-wide CSS and JavaScript. Uploaded images are checked on the server: by content, not just
by name, up to 1 MB, with safe file names. Theme images are served so an SVG opened directly
can't run script.

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
- `veneer.readList()`, `veneer.openRow(record, '5')`, `veneer.readPages({ from, to })`: read
  a whole list or every page of a screen, and go back to a row, as components do
  ([below](#custom-components)).

The app root carries `data-screen="<definition id>"`, so site CSS can target one screen.
Scripts pause while designing; **Test script** runs the draft once. A changed page-load
script runs after a page reload.

**Custom code runs with the page's full rights**, like Veneer's own code: it can read
everything users type, passwords included. Give designer access only to people you'd
trust to change the site's code, and review definitions in git like code.

### Custom components

For things the designer can't build, such as a chart, a signature pad or a lookup in another
system, developers write **components**: ES modules in the server's components folder
(`VENEER_COMPONENTS_DIR`, default `components/` in the repo), one `name.js` per component.
Veneer serves them at `/components/` and lists them at `/api/components`. Nothing in the
designer can add or change them: designers place installed components and set their options.
A component can import other files from the same folder. Browsers load a new version after
a page reload; the server lists new files after a restart.

A component draws in a box over the screen, or in place of an input field:

```json
{ "op": "component", "name": "bar-chart", "at": { "row": 17, "col": 2 }, "width": 76, "height": 4,
  "options": { "column": "Amount", "label": "Order" } }
{ "op": "component", "name": "star-rating", "at": { "row": 19, "col": 24 }, "width": 5, "height": 1,
  "field": "19:24", "options": { "max": 5 } }
```

In the designer, add one from the Page tab's **Components** section, or select a field and
choose **Show as: Component**. Select it to pick another component, edit its options (JSON),
move it or resize it.

The module exports `mount(element, ctx)`, and optionally a `label`. `mount` draws into
`element` and may return `{ update(ctx), unmount() }` (or just a cleanup function).
`update` is called when the screen is redrawn or the bound field's value changes; keep the
newest `ctx` it is given. `ctx` has:

- `options`: the change's options.
- `screen`: `{ id, definition, host, rows, cols, lines, fields }`, as for scripts (`host` is
  `"5250"` or `"3270"`).
- `tables`: the lists on the screen, in screen order, including lists the definition hides
  (so a component can take a list's place). Each is
  `{ row, col, columns, rows, records, options, more, hidden, pageKey }`: `columns` are the
  headings, `rows` each row's cells as text, `options` the legend's options (`[{ value: "5",
  label: "Display" }]`), `more` whether paging down shows more, `hidden` whether the
  definition hides it, and `pageKey` names the page showing (one of `readList`'s `pageKeys`
  when that page was read). `records` are the same rows with more detail: `{ row, cells, raw,
  fields, option, role, roles }`, where `raw` is the cells untrimmed (to see indenting),
  `fields` holds each cell's input field id (or `null`), `option` is the row's option field
  id (or `null`), `role` the role a style rule gave the row, and `roles` each cell's role. To
  pick an option on a row, `press('Enter', { [record.option]: '5' })`.
- For a field: `field` (`{ id, length }`), `value` and `setValue(text)`, which types into it.
- `getField(id)`, `setField(id, text)` and `press(key, fields?)`, which go through the
  same path as the user typing and pressing keys.
- `readList({ at?, maxPages? })`: the whole list (the first on the screen, or the one at
  `at`), read as Export reads it: to the top, down to the bottom and back to the user's page,
  with Export's progress and Cancel for a long one. It resolves to `{ columns, rows, records,
  options, pages, current, pageKeys, complete }`, where `columns` leave out the option column
  as Export does, each record is `{ cells, raw, role, option, page, index }`, and `complete`
  is false if it stopped at `maxPages` (default 500). Components on the same screen share one
  reading. It rejects (with a message to show) when something typed hasn't been sent yet,
  another reading is running, or the user cancels. In the designer it gives the page showing.
- `openRow(record, option)`: pages from wherever the list is to a record `readList` gave,
  types the option into its row and presses Enter. It rejects, and tells the user, if that
  page no longer looks as it did when read.
- `readPages({ from, to, maxPages? })`: every page of rows `from` to `to` (1-based) of the
  screen, such as a spooled file's text: `{ pages, current, complete }`, each page its lines.
  The last page is the one showing "Bottom" or "BOTTOM OF DATA", or where Page Down stops
  moving.
- `design`: true in the designer, where typing and keys do nothing.

```js
export const label = 'Hello';
export function mount(element, ctx) {
  element.textContent = `Hello from ${ctx.screen.id}`;
  return { update: (next) => { element.textContent = `Hello from ${next.screen.id}`; } };
}
```

A component that can't be loaded, or throws, is reported in the browser console, and a field
it replaced gets its normal input back; the designer shows a note in its box. Components run
with the page's full rights, like designers' scripts, so only install code you have reviewed.

### Ready-made components

Veneer comes with sixteen components, in `examples/components/` of the release (in the
repo: `packages/server/dev/components/`, which `npm run demo` uses).
**[The components guide](docs/components.md)** covers each one's options and use.

| Component | Shows |
| --- | --- |
| `list-table.js` | Every row of a list in one table, to sort, filter and search ([guide](docs/components.md#whole-list-table)) |
| `totals.js` | Count, sum, average, lowest or highest of a list's columns, as tiles ([guide](docs/components.md#totals)) |
| `bar-chart.js` | A list's columns as bars, stacked bars, lines, a pie or donut, or a sparkline ([guide](docs/components.md#chart)) |
| `board.js` | A list's rows as cards in a column per status ([guide](docs/components.md#board)) |
| `calendar.js` | A list's rows on a month or week calendar, by a date column ([guide](docs/components.md#calendar)) |
| `tree.js` | An indented list (a bill of materials, folders) as a tree that opens and closes ([guide](docs/components.md#tree)) |
| `pin-map.js` | Every row of a list as a pin on one map ([guide](docs/components.md#pin-map)) |
| `cards.js` | A list as cards, one per row, with the list's options as buttons ([below](#card-view-component)) |
| `spool.js` | A spooled file (DSPSPLF, SDSF) as one document to scroll, search and download ([guide](docs/components.md#spool-file)) |
| `scanner.js` | A camera button beside a field that types the barcode it reads ([guide](docs/components.md#barcode-scanner)) |
| `help-panel.js` | Help for a screen, written in Markdown, opened by F1 or a button ([guide](docs/components.md#help-panel)) |
| `embed.js` | A page from another system, its address built from the screen ([guide](docs/components.md#embedded-page)) |
| `timeline.js` | A status as steps: Ordered → Shipped → Delivered ([guide](docs/components.md#status-timeline)) |
| `map.js` | An address from the screen on a map ([below](#map-component)) |
| `star-rating.js` | A one-digit field as stars |

The components that show a list can read **the whole list**, not just the page showing: they
page through it as Export does and come back to the user's page, and an option on a row
pages to that row and runs it. They share code in the `lib/` folder; copy it along with
them. The board also needs `cards.js`, and the pin map `map.js`.

To install one, copy it into the server's components folder (`VENEER_COMPONENTS_DIR`) and
restart Veneer. On a server install, keep components outside the program directory, next
to the configuration, so upgrades keep them:

| Install | Components folder | Set in `veneer.env` |
| --- | --- | --- |
| IBM i | `/QOpenSys/etc/veneer/components` | `VENEER_COMPONENTS_DIR=/QOpenSys/etc/veneer/components` |
| Linux | `/etc/veneer/components` | `VENEER_COMPONENTS_DIR=/etc/veneer/components` |
| Docker | `/app/components`: mount a folder there, `-v ./components:/app/components:ro` | nothing |
| Development | `components/` in the repo (git-ignored) | nothing |

```sh
# IBM i (QSH or SSH)
mkdir -p /QOpenSys/etc/veneer/components
cp /QOpenSys/opt/veneer/current/examples/components/map.js /QOpenSys/etc/veneer/components/
```

The service user needs to read the folder, not write it. An upgrade doesn't change your
copy; to get a newer version of a component, copy it again from `examples/components/`.

### Map component

`map.js` shows an address from the screen on a map, with an **Open in maps** link to the
full map in a new tab. Use it on any screen that shows an address: customers, ship-to
addresses, warehouses, service calls. Several maps can share a screen, such as billing and
shipping side by side. The demo's option 3, **Customer addresses**, has an example.

**Add a map to one of your screens:**

1. **Install** `map.js` (above).
2. **Find the address on the screen.** Write down the row and column where each part
   starts (rows and columns count from 1, as in screen definitions): for example, the street
   at row 8, column 4, the city at row 9, column 4, and the state and ZIP code at row 10,
   columns 4 and 8.
3. **Place the map.** In the designer, open the screen, then the Page tab's **Components**
   section, and add **Map**. Drag it to an empty area and drag its corner to size it; about
   35 columns by 8 rows works well.
4. **Set its options** (the JSON box on the Selected tab):
   ```json
   { "address": ["8:4", "9:4", "{10:4} {10:8}", "USA"], "title": "Ship to" }
   ```
5. In the designer the map stays blank until you click **Show map**, so the addresses of
   the records you design with aren't sent to the map provider by accident. Click it to
   check the map, then **Save**. Users see the map on the next screen.

**Options:**

| Option | |
| --- | --- |
| `address` | Required. The parts of the address, joined with commas. `"8:4"` is the field starting at row 8, column 4 (what the user has typed included), or else the screen text there up to the next double space. `"8:4:30"` takes exactly 30 characters. A part can mix positions and text, like `"{10:4} {10:8}"` (state and ZIP code on one line) or `"USA"` |
| `title` | A caption above the map |
| `provider` | `openstreetmap` (the default) or `google` |
| `apiKey` | A Google Maps Embed API key, for `google`. Without one, Google's keyless embed is used |
| `zoom` | 1 (the world) to 19 (a building). Default 15 (streets) |
| `geocoder` | For `openstreetmap`: a Nominatim search address (`https://…`) to use instead of `nominatim.openstreetmap.org` |
| `link` | `false` hides the **Open in maps** link |

Fixed text such as `"USA"` never makes a map on its own: when every position in the address
is blank (a new record, say), the map says there's no address. The map follows the screen:
paging to the next record, or editing an address field, redraws it a moment after the
address stops changing.

**Choosing a provider:**

- **OpenStreetMap** needs no key or account. It first finds the address's coordinates
  with OpenStreetMap's Nominatim service, then shows the map. Nominatim is free for light
  use: about one lookup a second for the whole site, and each address is looked up once per
  page. For heavier use, run your own Nominatim (or a compatible service) and point
  `geocoder` at it, or use Google.
- **Google Maps** places the address itself, so there's no lookup step. Without `apiKey`,
  Veneer uses Google's keyless embed, which works but is not an official API. For production
  use, create a Maps Embed API key in the Google Cloud console, restrict it to your Veneer
  site's address, and set `apiKey`.

**Privacy:** the map provider receives every address shown in a map, and the user's
browser connects to it directly. Check that this is acceptable for your data before turning
maps on. Only the address is sent, never other fields from the screen.

**Network and firewalls:** users' browsers (not the Veneer server) must reach the provider:
`www.openstreetmap.org`, `tile.openstreetmap.org` and the geocoder for OpenStreetMap, or
`www.google.com` and `maps.google.com` for Google. If your site adds a Content-Security-Policy
in front of Veneer, allow those hosts in `frame-src`, and the geocoder in `connect-src`.

### Card view component

`cards.js` shows a list (a subfile) as cards, one per row: a title, a subtitle and a few
facts, with the list's options (`2=Change  5=Display`) as buttons. Lists of people, customers
or items with a few key facts each read better this way than as rows. The demo's option 4,
**Customer contacts**, has an example.

**Show one of your lists as cards:**

1. **Install** `cards.js` ([above](#ready-made-components)).
2. **Hide the list.** In the designer, open the screen, select the list and tick **Hide**.
   Also hide the option legend above it (each option, such as `2=Change`, is its own item)
   and the **More** / **Bottom** marker under it, and the "Type options, press Enter." line if
   you like. A hidden list isn't drawn, but its option fields are still on the screen,
   and the cards type into them.
3. **Place the cards.** In the Page tab's **Components** section, add **Cards**, and drag
   and size it over the space the list and its legend used. Give it room: cards wrap into
   as many columns as fit, and scroll if there are more rows than fit.
4. **Set its options** (the JSON box on the Selected tab), naming columns by their headings:
   ```json
   { "title": "Name", "subtitle": "Company", "fields": ["City", "Phone", "Status"], "default": "5" }
   ```
5. **Save.** Users see cards on the next screen.

**Options:**

| Option | |
| --- | --- |
| `title` | The column for each card's title. Default: the first column after the option column |
| `subtitle` | A column shown under the title |
| `fields` | The columns shown on each card, in order, as "heading value". Default: every other column |
| `actions` | Which options to offer as buttons, in order, by value: `["5", "2"]`. Default: all the legend's options. `[]` for none |
| `default` | The option a click on a card, or Enter on it, runs: `"5"`. Default: none, so only the buttons do something |
| `pager` | `false` hides the **Previous** and **Next** buttons |
| `width` | The narrowest a card gets, in pixels (120 to 600). Default 220 |
| `empty` | What to say when the list has no rows. Default "Nothing to show" |

Headings are matched ignoring case. With several lists on a screen, the cards show the first
one that has every column the options name (or the first list, if they name none).

**What the user can do:** a button types its option into that row's option field and
presses Enter, exactly as if the user had typed it, so the program sees nothing new.
**Previous** and **Next** press Page Up and Page Down; **Next** shows only when the host says
there is more. The keyboard works too: Tab reaches the cards, the arrow keys, Home and End
move between them, and Enter runs `default`. After a press the buttons wait for the next
screen, so a double click sends one key.

**Colors:** [style rules](#screen-customizations-and-the-designer) carry over. A rule that
colors a whole row colors that card's edge (a `danger` row gives a red card); a rule that
colors one cell colors that fact; `muted` rows are faded.

A list without an option legend still shows as cards, without buttons. In the designer the
cards are drawn, but clicking them does nothing.

## Branding

Server settings put a company's name, logo and color on every page, the admin page included:

| Setting | |
| --- | --- |
| `VENEER_BRAND_NAME` | Product name: the header when a screen has no title, and the browser tab |
| `VENEER_BRAND_LOGO` | Path to a PNG, SVG, JPEG, WebP or GIF (up to 1 MB), shown 32px high in the header and used as the tab icon |
| `VENEER_BRAND_ACCENT` | Accent color, as hex (`#0a7f5a`): buttons, links, focus rings, highlights |
| `VENEER_BRAND_ACCENT_DARK` | Optional accent for dark mode; without it, dark mode uses a lighter shade of the accent |

Light and dark mode still follow the browser. Pick an accent that white text reads well on,
since the main buttons use it as their background. Restart the server after changing these.

A screen definition can use its own accent, for instance a color per application area, by
setting the same variables in its CSS: `:root { --brand-accent: #8a3ffc; }` (and
`--brand-accent-dark` if needed). `global.css` can do the same for every page. A
[theme](#themes) that sets an accent or has a logo overrides `VENEER_BRAND_ACCENT` and
`VENEER_BRAND_LOGO`; where it sets neither, these settings still apply.

## License

[MIT](LICENSE) © 2026 Daniel Long
