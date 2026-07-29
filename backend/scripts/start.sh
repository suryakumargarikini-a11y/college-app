#!/bin/sh

# SITAM Smart ERP -- Production entrypoint
# 1. Deletes any failed Phase 2A migration rows directly from _prisma_migrations
#    (caused by BOM in first deploy attempt). Non-fatal if table doesn't exist yet.
# 2. Runs prisma migrate deploy to apply all pending migrations.
# 3. Seeds DepartmentAlias table (idempotent upserts).
# 4. Starts the server.

echo '[start.sh] Step 1: Clearing failed migration records...'
node scripts/fix-failed-migrations.js
echo '[start.sh] Step 1 complete.'

echo '[start.sh] Step 2: Applying pending migrations...'
npx prisma migrate deploy
echo '[start.sh] Step 2 complete.'

echo '[start.sh] Step 3: Seeding department aliases...'
node scripts/seed-department-aliases.js
echo '[start.sh] Step 3 complete.'

echo '[start.sh] Step 4: Starting server...'
exec node server.js
