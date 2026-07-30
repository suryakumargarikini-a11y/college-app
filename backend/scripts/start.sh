#!/bin/sh
set -e

echo "[ENTRYPOINT] pid=$$ ppid=$PPID time=$(date -Iseconds 2>/dev/null || date)"
echo "[RUNTIME-DIAG] Pre-chown User identity: $(id)"

echo '[start.sh] Preparing upload directories with node:node ownership...'
mkdir -p uploads/photos uploads/achievements uploads/library 2>/dev/null || true
chown -R node:node uploads 2>/dev/null || true
chmod -R 755 uploads 2>/dev/null || true

echo '[start.sh] Running pending Prisma database migrations...'
npx prisma migrate deploy --schema=prisma/schema.postgresql.prisma || {
    echo '[start.sh] ERROR: Prisma migration deploy failed!'
    exit 1
}

echo '[start.sh] Upload directories ready.'
echo '[ENTRYPOINT->NODE] Dropping privileges to node user (UID 1000)...'

if [ "$(id -u)" = "0" ]; then
    exec su -s /bin/sh node -c "exec node server.js"
else
    exec node server.js
fi