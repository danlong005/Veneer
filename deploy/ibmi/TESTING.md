# Testing Veneer on IBM i (issue #1)

Issue #1 is built and verified on Linux. The last acceptance item is running it on a real
IBM i. That work is not committed yet.

- **Archive:** `release/veneer-0.1.0.tar.gz`. Rebuild with `npm run package` if the code
  has changed since.
- **Target needs:** Node.js 20.12 or later. No `npm install`, compiler or internet access.
- **Verified on Linux:**
  - A clean extract, started through `deploy/ibmi/veneer.sh` with a config file.
  - The health check, client, a 5250 session and file logging.
  - A clean stop on SIGTERM.
  - All of the above on Node 20.20.2 and 24.
- **Not verified yet:**
  - PASE `gzip`/`tar` extraction.
  - `SBMJOB` with `QP2SHELL2` and `ALWMLTTHD(*YES)`.
  - `ENDJOB *CNTRLD` triggering the clean stop.
  - The Service Commander keys in `deploy/ibmi/veneer.yaml`.

## Part A: test from your home directory (works on pub400)

This path needs no admin authority. pub400's SSH port is 2222; on another system, drop
`-P 2222` / `-p 2222`. Replace `YOURUSER` everywhere. PASE home directories are
lowercase, so `/home/YOURUSER` is usually `/home/yourname`.

**1. Copy the archive and sign in.**

```sh
scp -P 2222 release/veneer-0.1.0.tar.gz YOURUSER@pub400.com:
ssh -p 2222 YOURUSER@pub400.com
```

**2. In the SSH session (PASE), check Node and unpack.** If `node` is missing,
`yum install nodejs22` needs authority you may not have on pub400.

```sh
export PATH=/QOpenSys/pkgs/bin:$PATH
node -v                      # needs v20.12 or later
mkdir -p ~/veneer/etc/screens ~/veneer/log
cd ~/veneer
gzip -dc ~/veneer-0.1.0.tar.gz | tar -xf -
ln -sfn veneer-0.1.0 current
ls current                   # expect: packages/ deploy/ node_modules/ veneer.env.example
```

**3. Create the config file.** pub400 is shared, so use an uncommon port. The same
number goes in steps 4 and 5.

```sh
cat > ~/veneer/etc/veneer.env <<'EOF'
VENEER_HOST=localhost
VENEER_PORT=23
VENEER_TLS=false
VENEER_LISTEN_HOST=127.0.0.1
VENEER_LISTEN_PORT=18250
VENEER_SCREENS_DIR=/home/YOURUSER/veneer/etc/screens
VENEER_LOG_FILE=/home/YOURUSER/veneer/log/veneer.log
VENEER_DESIGNER_TOKEN=pick-a-long-secret-here
EOF
chmod 600 ~/veneer/etc/veneer.env
```

**4. Run it in the foreground.**

```sh
VENEER_CONFIG=~/veneer/etc/veneer.env ~/veneer/current/deploy/ibmi/veneer.sh
```

- In a second SSH session, run `curl http://127.0.0.1:18250/healthz` and
  `tail ~/veneer/log/veneer.log`.
- The log should start with a "listening" line showing the version and Node version.
- If the port is in use, it logs the error and exits with status 1. That is one of the
  things being tested.

**5. Open it in your browser through an SSH tunnel.** Veneer listens only on 127.0.0.1.
The tunnel also encrypts the connection, so no HTTPS certificate is needed. Run this on
your PC:

```sh
ssh -p 2222 -N -L 18250:127.0.0.1:18250 YOURUSER@pub400.com
```

Then browse to **http://localhost:18250** and:

- [ ] Sign on.
- [ ] Run `WRKACTJOB` and a few menus.
- [ ] Try the Design button, using the token from step 3.
- [ ] Press Ctrl+C in the first SSH session. The browser shows "Server shutting down",
  and the log has `shutting down` and `session closed` lines.

**6. Run it as a batch job.** This is the IBM i–specific part that hasn't been tested
yet. `SBMJOB` doesn't pass `VENEER_CONFIG` through, so first point the script's default
config path at your file. If PASE `sed` rejects `-i`, edit the file in `vi`.

```sh
sed -i 's|/QOpenSys/etc/veneer/veneer.env|/home/YOURUSER/veneer/etc/veneer.env|' ~/veneer/current/deploy/ibmi/veneer.sh
```

Then, from a 5250 command line:

```
SBMJOB CMD(CALL PGM(QP2SHELL2) PARM('/home/YOURUSER/veneer/current/deploy/ibmi/veneer.sh'))
       JOB(VENEER) ALWMLTTHD(*YES)
```

- [ ] `WRKSBMJOB`: the job stays active rather than ending in error. If it fails,
  `DSPJOBLOG` shows why.
- [ ] Repeat the step 5 tunnel and browser test.
- [ ] With a session open, run `ENDJOB JOB(VENEER) OPTION(*CNTRLD) DELAY(30)`. The
  browser gets "Server shutting down", the job ends within seconds rather than after
  30, and the log shows `shutting down` with `"signal":"SIGTERM"`.

## Part B: full service install (an IBM i with admin authority)

Follow [deploy/README.md](../README.md):

1. Run `CRTUSRPRF VENEER`.
2. Unpack into `/QOpenSys/opt/veneer`.
3. Put the config in `/QOpenSys/etc/veneer/veneer.env`.
4. Start it with Service Commander (`sc start veneer`, `sc check veneer`, `sc stop veneer`)
   or with `SBMJOB … USER(VENEER) JOBQ(QSYSNOMAX)`.

With Service Commander, watch whether it accepts `deploy/ibmi/veneer.yaml`. Its keys were
written from memory, so record any error from `sc start`.

## What to record

- The output of `node -v`.
- Any errors from `gzip`/`tar`, `veneer.sh`, `sc`, or `DSPJOBLOG`.
- Whether `ENDJOB *CNTRLD` stopped it quickly, plus the last few log lines.
- Any screen that renders wrong. Classic and Modern views side by side show the problem.

After testing, fix anything that failed. Then commit with "Refs #1" (or close #1 if all
passes) and add the results to the issue.
