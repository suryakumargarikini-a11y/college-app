#!/bin/sh
set -e

# SITAM Smart ERP -- Production entrypoint
# Runs tracked Prisma migrations then starts the server.
# migrate deploy is idempotent: already-applied migrations are skipped.

echo '[start.sh] Running Prisma migrations...'
npx prisma migrate deploy
echo '[start.sh] Migrations complete.'

echo '[start.sh] Seeding department aliases...'
node scripts/seed-department-aliases.js
echo '[start.sh] Aliases seeded.'

echo '[start.sh] Starting server...'
exec node server.js
