# Trying Veneer on z/OS: IBM Z Xplore

[IBM Z Xplore](https://www.ibm.com/z/resources/zxplore) is IBM's free mainframe learning
platform. Sign up and you get a user ID on a real z/OS system, with TSO and ISPF. It's
where Veneer's 3270 support was tested against z/OS (z/OS 3.1, ISPF 8.1; issue #33).
Unlike [TK4-](tk4.md), it speaks TN3270E, so it also exercises BIND, SYSREQ and TSO
reconnect.

## Point Veneer at it

In `.env`, or as environment variables:

```sh
VENEER_HOST_TYPE=3270
VENEER_HOST=204.90.115.200
VENEER_PORT=623
VENEER_TLS=false
VENEER_LISTEN_PORT=8085
```

Z Xplore's 3270 port is plain TN3270E, with no TLS. Your password crosses the internet
unencrypted, as it does from any emulator connecting to that port, so don't use it
anywhere else. Leave `VENEER_DEVNAME_PREFIX` blank: Z Xplore assigns the LU.

Then `npm run dev` (or `npm start` after `npm run build`) and browse to
http://127.0.0.1:8085. To keep an IBM i Veneer on 8080 at the same time, start the second
one with these settings in its environment instead of `.env`.

## Log on

1. The first screen is the VTAM welcome screen. Log on to TSO with your Z Xplore user ID,
   as the screen tells you.
2. At the TSO/E logon screen, type your password and press Enter.
3. Press Enter at each `***` until ISPF's Primary Option Menu appears.

Things worth trying, all of which were tested:

- **3.4**, the data set list, with your user ID as the prefix: PF7 and PF8 page it, and `V`
  typed next to a data set views it.
- The action bar and its pull-downs (**File**, **Edit**, …), shown as windows; F12 closes them.
- **6**, the Command Shell, for TSO commands such as `LISTCAT`. Retrieve an earlier
  command by putting the cursor on it and pressing Enter.
- **Attention** (System menu, or PA1 under **Keys**) to interrupt a long `LISTCAT`; Clear;
  PA2 to show the screen again.
- **System Request** (System menu), which switches to the SSCP-LU session and back.

## Log off before closing the tab

Type `=X` to leave ISPF, then `LOGOFF` at `READY`. If a connection drops (a closed tab, once
Veneer's resume grace period ends, or a stopped Veneer), z/OS keeps your TSO session for a
while. The next logon shows "already logged on": answer with `LOGON userid RECONNECT` to
take it over.

## What Z Xplore can't test

- **TLS:** the 3270 port is plain TN3270E.
- **LU names:** you can't ask for an LU by name, or test an LU that's already in use.
- **CICS and IMS** screens.
- **Code pages other than 37.**
