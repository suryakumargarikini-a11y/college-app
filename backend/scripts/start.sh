#!/bin/sh
set -e

echo '[start.sh] Running pending Prisma migrations...'
npx prisma migrate deploy

echo '[start.sh] Preparing upload directories...'
mkdir -p uploads/photos uploads/achievements uploads/library 2>/dev/null || true

echo '[start.sh] Migrations complete.'
echo '[start.sh] Starting application server...'
exec node server.js