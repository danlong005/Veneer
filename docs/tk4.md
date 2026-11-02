# Trying Veneer on a free mainframe: TK4-

[TK4-](https://wotho.pebble-beach.ch/tk4-/) is MVS 3.8j, a free, old IBM mainframe
operating system, set up with TSO, VTAM and many tools, running on the Hercules
emulator. It's what Veneer's 3270 support was tested against (issue #31). Hercules
speaks plain TN3270, so TK4- can't test TLS, TN3270E or LU names; see "What TK4- can't
test" below.

## Start TK4-

With Docker:

```sh
docker run -d --name tk4-hercules -p 3270:3270 -p 8038:8038 ghcr.io/skunklabz/tk4-hercules:latest
```

Port 3270 is for terminals and 8038 is the Hercules console in a browser. MVS takes a
minute or two to start. It's ready when the Hercules console's system log
(http://localhost:8038, **System Log**) shows:

```
MVS038J MVS 3.8j TK4- system initialization complete
```

## Point Veneer at it

In `.env`, or as environment variables:

```sh
VENEER_HOST_TYPE=3270
VENEER_HOST=127.0.0.1
VENEER_PORT=3270
VENEER_TLS=false
VENEER_LISTEN_PORT=8085
```

Then `npm run dev` (or `npm start` after `npm run build`) and browse to
http://127.0.0.1:8085. To keep an IBM i Veneer on 8080 at the same time, start the second
one with these settings in its environment instead of `.env`.

`VENEER_TERMINAL_TYPE=IBM-3278-5-E` makes the terminal a model 5: TK4-'s menus then use
27x132 screens.

## Log on

1. The first screen is Hercules's own banner (Hercules version, device number). Press
   **Enter**: MVS sends its logon screen only once the terminal has sent a key.
2. At `Logon ===>`, type a user ID and press Enter. TK4- comes with `HERC01` and `HERC02`
   (password `CUL8TR`), and `HERC03` and `HERC04` (password `PASS4U`).
3. Type the password (it isn't shown) and press Enter.
4. Press Enter at each `***` (the welcome, then a fortune) to get the **TSO
   Applications** menu.

The menu has RFE and RPF (ISPF-like tools: try `1`, then `3.4` and a prefix such as
`SYS1` for a data set list), a system monitor, a spool browser, help, and **TERMTEST**
(option 7). TERMTEST shows what TSO learned from the terminal (size, colours, query
replies) and echoes, in hex, exactly what each key sent, which makes it a good way to
check a terminal.

PF3 leaves the menu for TSO's `READY` prompt, where TSO commands such as `TIME` and
`LISTCAT LEVEL(SYS1)` work. `TSOAPPLS` brings the menu back.

## Log off before closing the tab

Type `LOGOFF` at `READY` (PF3 out of any tool first). MVS 3.8j can't reconnect a TSO
user to a new terminal, so a session whose connection drops (a closed tab, once Veneer's
resume grace period ends, or a stopped Veneer) stays logged on, and the next logon as
that user is refused as in use. To end it, type this in the command box of the Hercules
console (http://localhost:8038) and press Enter:

```
/c u=herc01
```

Also avoid connecting and dropping terminals over and over in a short time. While
testing, a burst of about 30 quick connections ended with an I/O error on a terminal
and MVS stopping (`disabled wait state ... 00000066` in the Hercules log). If that
happens, every terminal shows only the Hercules banner; restart the container
(`docker restart tk4-hercules`) and wait for MVS to start again.

## Recording what TK4- sends

With `VENEER_TRACE=true`, Veneer logs every record from the host in hex, and from the
browser only the key and cursor (never what was typed). The screens in
`packages/tn3270/test/fixtures/tk4.json` were recorded this way: the VTAM logon screen,
TSO's password prompt, the TSO Applications menu on a model 2 and a model 5, TSO line
mode (READY, LISTCAT), two pages of RFE's data set list, and TERMTEST. The tests replay them, so a
change that breaks a real host's screens fails the build.

## What TK4- can't test

Hercules's TN3270 server is plain TN3270: no TLS, no TN3270E (so no LU names, SYSREQ or
BIND notifications), and terminals are named by device number (`CUU0C0`). Those, CICS,
IMS and code pages other than 37 need a z/OS system. Veneer's demo mainframe
(`npm run demo -- --3270`) covers TN3270E's protocol, but only against Veneer's own
reading of the standard.
