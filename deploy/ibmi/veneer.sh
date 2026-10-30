#!/QOpenSys/usr/bin/sh
# Runs Veneer in the foreground. Used by SBMJOB, Service Commander, or a terminal.
#   VENEER_CONFIG  config file (default /QOpenSys/etc/veneer/veneer.env)
#   VENEER_NODE    node binary (default: found under /QOpenSys/pkgs)

DIR=$(cd "$(dirname "$0")/../.." && pwd)
CONFIG=${VENEER_CONFIG:-/QOpenSys/etc/veneer/veneer.env}

NODE=${VENEER_NODE:-}
if [ -z "$NODE" ]; then
  for candidate in /QOpenSys/pkgs/bin/node /QOpenSys/pkgs/lib/nodejs22/bin/node /QOpenSys/pkgs/lib/nodejs20/bin/node; do
    if [ -x "$candidate" ]; then NODE=$candidate; break; fi
  done
fi
if [ -z "$NODE" ]; then
  echo "veneer: Node.js not found. Install it with 'yum install nodejs22' (or nodejs20), or set VENEER_NODE." >&2
  exit 1
fi

export PATH=/QOpenSys/pkgs/bin:$PATH
# A batch job starts with umask 0, which would leave the log, inventory and saved
# screen definitions writable by every user.
umask 027
exec "$NODE" "$DIR/packages/server/dist/main.js" --config "$CONFIG"
