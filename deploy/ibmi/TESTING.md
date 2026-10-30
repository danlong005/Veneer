# Testing Veneer on IBM i (issue #1)

Issue #1 is built and verified on Linux, and Parts A and B below have both passed on a
real IBM i. Use this file to repeat the test on another system or a new release.

- **Archive:** `release/veneer-0.1.0.tar.gz`. Rebuild with `npm run package` if the code
  has changed since.
- **Target needs:** Node.js 20.12 or later. No `npm install`, compiler or internet access.
- **Verified on Linux:**
  - A clean extract, started through `deploy/ibmi/veneer.sh` with a config file.
  - The health check, client, a 5250 session and file logging.
  - A clean stop on SIGTERM.
  - All of the above on Node 20.20.2 and 24.
- **Verified on IBM i** (2026-10-30, IBM i 7.6, Node v24.20.0, from a home directory):
  - PASE `gzip`/`tar` extraction.
  - Running in the foreground through `veneer.sh`: health check, a 5250 session through an
    SSH tunnel, a clean stop on SIGTERM.
  - `SBMJOB` with `QP2SHELL2` and `ALWMLTTHD(*YES)`: the job stays active, running `node`
    in the submitted job itself.
  - `ENDJOB *CNTRLD DELAY(30)` with a session open: Veneer logged `shutting down` with
    `"signal":"SIGTERM"` and `session closed`, and the job ended in under 3 seconds with
    end code 10.
- **Verified on IBM i, Part B** (same system, Service Commander 1.7.1):
  - The install from [deploy/README.md](../README.md): the `VENEER` profile, the
    `/QOpenSys` directories, the program owned by the admin and the config, screens,
    data and log owned by `VENEER`.
  - `SBMJOB … USER(VENEER) JOBQ(QSYSNOMAX)`: a session, the screen inventory saved to
    `/QOpenSys/var/lib/veneer`, a designer save to `/QOpenSys/etc/veneer/screens`, and
    `ENDJOB *CNTRLD`.
  - `sc start veneer`, `sc check veneer`, and `sc stop veneer` with a session open: the
    browser shows "Server shutting down" and the job ends with end code 10.
- **Found on IBM i and fixed:**
  - PASE `sed` has no `-i`. Step 6 now avoids it.
  - A failed batch start looks like a normal end (end code 0, no job log). The error is in
    the job's `QPRINT` spooled file. This is now documented in
    [deploy/README.md](../README.md#if-the-job-ends-right-away) and in step 6.
  - A job on `QBATCH` blocked every later `QBATCH` job. Step 6 now uses `QSYSNOMAX`.
  - After a shutdown, the browser kept retrying ("Connecting…") for about 40 seconds
    before saying why. It now shows "Server shutting down" at once.
  - Without `VENEER_DATA_DIR`, the screen inventory was saved inside the install
    directory. Step 3 now sets it, and Veneer warns at startup when a production
    configuration keeps data inside the install directory.
  - A batch job starts with umask 0, so the log, inventory and saved screen definitions
    were writable by every user. `veneer.sh` now sets umask 027.
  - `veneer.yaml` repeated `ALWMLTTHD(*YES)`, which Service Commander adds itself, so
    `SBMJOB` failed (CPD0042) and `sc start` timed out. It also used
    `check_alive_timeout`, which Service Commander doesn't recognize; the key is
    `startup_wait_time`.

## Part A: test from your home directory

This path needs no admin authority. Replace `YOURUSER` everywhere. PASE home directories
are usually lowercase (`/home/yourname`), but some systems use uppercase, so check with
`echo $HOME`. On pub400 the SSH port is 2222: add `-P 2222` to `scp` and `-p 2222` to `ssh`.

**1. Copy the archive and sign in.**

```sh
scp release/veneer-0.1.0.tar.gz YOURUSER@yourihost:
ssh YOURUSER@yourihost
```

**2. In the SSH session (PASE), check Node and unpack.** If `node` is missing,
`yum install nodejs22` needs authority you may not have.

```sh
export PATH=/QOpenSys/pkgs/bin:$PATH
node -v                      # needs v20.12 or later
mkdir -p ~/veneer/etc/screens ~/veneer/data ~/veneer/log
cd ~/veneer
gzip -dc ~/veneer-0.1.0.tar.gz | tar -xf -
ln -sfn veneer-0.1.0 current
ls current                   # expect: packages/ deploy/ node_modules/ veneer.env.example
```

**3. Create the config file.** On a shared system, use an uncommon port. The same
number goes in steps 4 and 5. `VENEER_DESIGNER=local` lets your browser use the designer
through the SSH tunnel without a token. Anyone else signed on to the machine could reach
it too, so stop Veneer when you're done.

```sh
cat > ~/veneer/etc/veneer.env <<'EOF'
VENEER_HOST=localhost
VENEER_PORT=23
VENEER_TLS=false
VENEER_LISTEN_HOST=127.0.0.1
VENEER_LISTEN_PORT=18250
VENEER_SCREENS_DIR=/home/YOURUSER/veneer/etc/screens
VENEER_DATA_DIR=/home/YOURUSER/veneer/data
VENEER_LOG_FILE=/home/YOURUSER/veneer/log/veneer.log
VENEER_DESIGNER=local
EOF
chmod 600 ~/veneer/etc/veneer.env
```

**4. Run it in the foreground.**

```sh
VENEER_CONFIG=~/veneer/etc/veneer.env ~/veneer/current/deploy/ibmi/veneer.sh
```

- In a second SSH session, run `curl http://127.0.0.1:18250/healthz` and
  `tail ~/veneer/log/veneer.log`.
- The log should start with a "listening" line showing the version and Node version, and
  no warnings about the install directory.
- If the port is in use, it logs the error and exits with status 1.

**5. Open it in your browser through an SSH tunnel.** Veneer listens only on 127.0.0.1.
The tunnel also encrypts the connection, so no HTTPS certificate is needed. Run this on
your PC:

```sh
ssh -N -L 18250:127.0.0.1:18250 YOURUSER@yourihost
```

Then browse to **http://localhost:18250** and:

- [ ] Sign on.
- [ ] Run `WRKACTJOB` and a few menus.
- [ ] Try the Design button. It should save without asking for a token.
- [ ] Press Ctrl+C in the first SSH session. The browser shows "Session ended: Server
  shutting down" right away, and the log has `shutting down` and `session closed` lines.

**6. Run it as a batch job.** `SBMJOB` doesn't pass `VENEER_CONFIG` through, so first
point the script's default config path at your file. PASE `sed` has no `-i`, so write
the result to a temporary file, then copy it back over the script. Copying keeps the
script's execute permission.

```sh
cd ~/veneer/current/deploy/ibmi
sed 's|/QOpenSys/etc/veneer/veneer.env|/home/YOURUSER/veneer/etc/veneer.env|' veneer.sh > veneer.sh.new
cat veneer.sh.new > veneer.sh && rm veneer.sh.new
grep ^CONFIG veneer.sh
```

Then, from a 5250 command line (or from PASE, inside `system "…"`):

```
SBMJOB CMD(CALL PGM(QP2SHELL2) PARM('/home/YOURUSER/veneer/current/deploy/ibmi/veneer.sh'))
       JOB(VENEER) JOBQ(QSYSNOMAX) ALWMLTTHD(*YES)
```

Use `QSYSNOMAX`, not the default `QBATCH`: Veneer runs until ended, and `QBATCH` often
runs one job at a time.

- [ ] `WRKSBMJOB`: the job stays active, showing `PGM-node`. If it ends right away, it
  still ends normally with no job log. Veneer's error is in the job's `QPRINT` spooled
  file (`WRKJOB JOB(nnnnnn/YOURUSER/VENEER) OPTION(*SPLF)`).
- [ ] Repeat the step 5 tunnel and browser test.
- [ ] With a session open, run `ENDJOB JOB(VENEER) OPTION(*CNTRLD) DELAY(30)`. The
  browser shows "Server shutting down", the job ends within seconds rather than after
  30, and the log shows `shutting down` with `"signal":"SIGTERM"`.

## Part B: full service install (an IBM i with admin authority)

Follow [deploy/README.md](../README.md):

1. Run `CRTUSRPRF VENEER`.
2. Unpack into `/QOpenSys/opt/veneer`.
3. Put the config in `/QOpenSys/etc/veneer/veneer.env`.
4. Start it with Service Commander (`sc start veneer`, `sc check veneer`, `sc stop veneer`)
   or with `SBMJOB … USER(VENEER) JOBQ(QSYSNOMAX)`.

With Service Commander, `sc info veneer` shows how it read `veneer.yaml` and warns about
unknown keys. If `sc start` times out, `sc -v start veneer` shows the `SBMJOB` it ran and
any error from it.

- [ ] Files Veneer creates (`veneer.log`, `inventory.json`, saved screens) are
  `rw-r-----`, not writable by everyone.

## Part C: TLS with the IBM i's own certificate

Not tested yet. pub400's certificate comes from a public authority, so `VENEER_TLS_CA` has
only been tried against a throwaway certificate on Linux. This part uses a certificate made
in Digital Certificate Manager (DCM). See "TLS and HTTPS" in
[deploy/README.md](../README.md#tls-and-https).

**1. Telnet over TLS on the IBM i.**

- [ ] In DCM, the certificate is assigned to `QIBM_QTV_TELNET_SERVER`, and `CHGTELNA
  ALWSSL(*YES)` is set. Restarting telnet ends active telnet sessions.
- [ ] In PASE, `openssl s_client -connect localhost:992 </dev/null | grep -E
  'subject=|issuer='` shows the certificate. Record its name (the `CN`, plus any
  alternative names) and its issuer.
- [ ] Export the issuer's certificate (the local CA) from DCM as a PEM file, for example
  `/QOpenSys/etc/veneer/ibmi-ca.pem`.

**2. Veneer on the IBM i, connecting to itself over TLS.** In the service's config file:

```sh
VENEER_HOST=<the name in the certificate>   # must resolve to this IBM i
VENEER_PORT=992
VENEER_TLS=true
VENEER_TLS_CA=/QOpenSys/etc/veneer/ibmi-ca.pem
```

- [ ] `sc restart veneer`, then the sign-on screen comes up through the browser tunnel.
- [ ] Without `VENEER_TLS_CA`, the log shows `host connect failed` with a certificate error,
  and the browser says "Host connection failed".
- [ ] With `VENEER_HOST=localhost`, the log shows `Hostname/IP does not match certificate's
  altnames` (unless the certificate covers `localhost`).

**3. Veneer on a PC, connecting to the IBM i over TLS.** Forward a local port to the IBM i's
992, for example `LocalForward 127.0.0.1:9992 localhost:992` in the tunnel's SSH config.
The name check needs the certificate's name, so map it to 127.0.0.1 in `/etc/hosts`, then
set that name in `VENEER_HOST`, `VENEER_PORT=9992` and `VENEER_TLS_CA` to a copy of the CA
file.

- [ ] The sign-on screen comes up, and the log's "listening" line shows `"tls":true`.

**4. HTTPS from the IBM i's certificate (optional).** If DCM lets you export the
certificate with its private key, convert it to PEM files (deploy/README.md shows how), set
`VENEER_HTTPS_CERT` and `VENEER_HTTPS_KEY`, and restart.

- [ ] `https://<the name in the certificate>:8080` loads. The browser trusts it only if the
  local CA is imported into the browser; record what it shows otherwise.

## What to record

- The output of `node -v`.
- Any errors from `gzip`/`tar`, `veneer.sh`, `sc`, or the job's `QPRINT` spooled file.
- Whether `ENDJOB *CNTRLD` stopped it quickly, plus the last few log lines.
- Any screen that renders wrong. Classic and Modern views side by side show the problem.

After testing, fix anything that failed. Then commit with "Refs #1" (or close #1 if all
passes) and add the results to the issue.
