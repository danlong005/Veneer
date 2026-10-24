# Deploying Veneer

Veneer ships as a self-contained archive, `veneer-<version>.tar.gz`, or as a Docker image
(see [Docker](#docker)). The archive holds the compiled server, the browser client and the
production dependencies, so the target needs only **Node.js 20.12 or later**: no compiler,
no `npm install`, and no internet access. Build it on a development machine:

```sh
npm ci
npm run package        # release/veneer-<version>.tar.gz and .sha256
```

Installs are laid out so that upgrades never touch configuration or customizations:

| | IBM i | Linux |
| --- | --- | --- |
| Program (one directory per version) | `/QOpenSys/opt/veneer/veneer-<version>` | `/opt/veneer/veneer-<version>` |
| Active version (symlink) | `/QOpenSys/opt/veneer/current` | `/opt/veneer/current` |
| Configuration | `/QOpenSys/etc/veneer/veneer.env` | `/etc/veneer/veneer.env` |
| Screen customizations | `/QOpenSys/etc/veneer/screens` | `/var/lib/veneer/screens` |
| Logs | `/QOpenSys/var/log/veneer/veneer.log` | the systemd journal (`journalctl -u veneer`) |

The configuration file uses the same settings as `.env` in development; the archive
includes a commented `veneer.env.example`. At a minimum, set `VENEER_HOST`, `VENEER_PORT`
and `VENEER_TLS`. Also set `VENEER_LISTEN_HOST`; the default is 127.0.0.1, which only
accepts connections from the server itself. If other machines will connect, set
`VENEER_HTTPS_CERT` and `VENEER_HTTPS_KEY` too, so sign-on passwords are encrypted. The
file may contain the designer token, so make it readable only by the service.

For the designer, `VENEER_DESIGNER=local` lets a browser on the server itself, or one
connected through an SSH tunnel, use it without a token. Behind a reverse proxy, requests
are never treated as local. Other people need `VENEER_DESIGNER_TOKEN`.

After starting, check the server:

```sh
curl http://127.0.0.1:8080/healthz    # {"status":"ok","version":"0.1.0",...}
```

## IBM i

You need Node.js from the IBM i open-source repositories: `yum install nodejs22` (or
`nodejs20`). Run the shell commands below in an SSH session (PASE), and the CL commands
from a 5250 command line.

### Install

1. Create a profile for the service. Users still sign on to their own 5250 sessions with
   their own profiles, so this profile needs no special authorities:

   ```
   CRTUSRPRF USRPRF(VENEER) PASSWORD(*NONE) USRCLS(*USER) TEXT('Veneer web server')
   ```

2. Unpack the archive and create the directories (PASE `tar` may not read gzip directly):

   ```sh
   mkdir -p /QOpenSys/opt/veneer /QOpenSys/etc/veneer/screens /QOpenSys/var/log/veneer
   cd /QOpenSys/opt/veneer
   gzip -dc /tmp/veneer-0.1.0.tar.gz | tar -xf -
   ln -sfn veneer-0.1.0 current
   cp current/veneer.env.example /QOpenSys/etc/veneer/veneer.env
   ```

3. Edit `/QOpenSys/etc/veneer/veneer.env`. For example:

   ```sh
   VENEER_HOST=localhost
   VENEER_PORT=23
   VENEER_TLS=false
   VENEER_LISTEN_HOST=0.0.0.0
   VENEER_HTTPS_CERT=/QOpenSys/etc/veneer/cert.pem
   VENEER_HTTPS_KEY=/QOpenSys/etc/veneer/key.pem
   VENEER_SCREENS_DIR=/QOpenSys/etc/veneer/screens
   VENEER_LOG_FILE=/QOpenSys/var/log/veneer/veneer.log
   ```

   Running on the IBM i itself, Veneer can use plain Telnet to `localhost` without the
   password crossing the network. The browser side still needs HTTPS.

4. Give the service profile access:

   ```sh
   chown -R VENEER /QOpenSys/etc/veneer /QOpenSys/var/log/veneer
   chmod 700 /QOpenSys/etc/veneer
   ```

### Start and stop

With [Service Commander](https://github.com/ThePrez/ServiceCommander-IBMi) (recommended):

```sh
cp /QOpenSys/opt/veneer/current/deploy/ibmi/veneer.yaml /QOpenSys/etc/sc/services/
sc start veneer
sc check veneer
sc stop veneer
```

Or with CL commands. Node.js needs a multithreaded job (`ALWMLTTHD(*YES)`), and
`QP2SHELL2` runs it in the submitted job itself, so ending that job stops Veneer:

```
SBMJOB CMD(CALL PGM(QP2SHELL2) PARM('/QOpenSys/opt/veneer/current/deploy/ibmi/veneer.sh'))
       JOB(VENEER) USER(VENEER) JOBQ(QSYSNOMAX) ALWMLTTHD(*YES)

ENDJOB JOB(VENEER) OPTION(*CNTRLD) DELAY(30)
```

A controlled end sends Veneer `SIGTERM`. Veneer then ends its 5250 sessions, which
releases their devices, and exits.

### Start at IPL

Add the `SBMJOB` above (or `sc start veneer`, run through `QSH`) to the system startup
program. `DSPSYSVAL QSTRUPPGM` shows which program that is.

## Linux

```sh
sudo useradd --system --home /var/lib/veneer --shell /usr/sbin/nologin veneer
sudo mkdir -p /opt/veneer /etc/veneer /var/lib/veneer/screens /var/log/veneer
sudo tar -xzf veneer-0.1.0.tar.gz -C /opt/veneer
sudo ln -sfn veneer-0.1.0 /opt/veneer/current
sudo cp /opt/veneer/current/veneer.env.example /etc/veneer/veneer.env
sudo chown -R veneer:veneer /var/lib/veneer /var/log/veneer
sudo chown root:veneer /etc/veneer/veneer.env && sudo chmod 640 /etc/veneer/veneer.env
# edit /etc/veneer/veneer.env; set VENEER_SCREENS_DIR=/var/lib/veneer/screens
sudo cp /opt/veneer/current/deploy/linux/veneer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now veneer
journalctl -u veneer -f
```

The unit expects `node` at `/usr/bin/node`; adjust `ExecStart` otherwise. The default port
is 8080. Ports below 1024 need `AmbientCapabilities=CAP_NET_BIND_SERVICE`, or a reverse
proxy in front.

## Docker

The image runs Veneer on Node.js 22 (Alpine) as a non-root user. It listens on port 8080
and keeps screen customizations in the `/data/screens` volume. Settings are the usual
`VENEER_*` environment variables; logs go to stdout (`docker logs`).

With Compose, from a checkout of the repository:

```sh
cp .env.example .env      # set VENEER_HOST, VENEER_PORT, VENEER_TLS
docker compose up --build -d
docker compose logs -f
```

`compose.yaml` reads `.env`, publishes port 8080, and mounts `./screens` as the
customizations folder so they can be committed to git. The container runs as user
`node` (uid 1000); if your user has a different uid, make `./screens` writable for 1000
(`sudo chown -R 1000 screens`) or the designer can't save.

Or build and run the image directly:

```sh
docker build -t veneer .
docker run -d --name veneer -p 8080:8080 \
  -e VENEER_HOST=myibmi.example.com -e VENEER_PORT=992 -e VENEER_TLS=true \
  -e VENEER_DESIGNER_TOKEN=a-long-secret-value \
  -v veneer-screens:/data/screens \
  veneer
```

Notes:

- **The designer needs `VENEER_DESIGNER_TOKEN` in Docker.** Through Docker's port
  mapping, browser requests arrive from the Docker network, not from 127.0.0.1, so
  `VENEER_DESIGNER=local` doesn't apply.
- **HTTPS:** mount the certificate files and set `VENEER_HTTPS_CERT` and
  `VENEER_HTTPS_KEY`, or put a reverse proxy in front.
- `VENEER_HOST=localhost` means the container itself. Use the IBM i's name or address.
- The health check calls `/healthz` (`docker ps` shows the status). `docker stop` sends
  SIGTERM, and Veneer ends its 5250 sessions before exiting; Compose allows 15 seconds.
- To upgrade, rebuild (`docker compose up --build -d`); customizations stay in the volume.

## Upgrade and roll back

Unpack the new version next to the old one, point `current` at it, and restart. The
configuration, customizations and logs live outside the program directory, so nothing
needs copying.

```sh
cd /QOpenSys/opt/veneer                  # /opt/veneer on Linux
gzip -dc /tmp/veneer-0.2.0.tar.gz | tar -xf -
ln -sfn veneer-0.2.0 current
# restart: sc restart veneer, ENDJOB + SBMJOB, or systemctl restart veneer
```

To roll back, point `current` at the previous version and restart. Restarting ends the
users' sessions, so do it outside working hours.

## Uninstall

Stop the service. Remove it from the startup program (IBM i), or run
`systemctl disable veneer` and delete the unit file (Linux). Then delete the program,
configuration and log directories, and on IBM i run `DLTUSRPRF VENEER`.
