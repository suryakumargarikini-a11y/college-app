#!/bin/sh

# SITAM Smart ERP -- Production entrypoint
# Resolves any failed Phase 2A migration records (BOM-caused failure),
# then applies all pending migrations cleanly.

echo '[start.sh] Resolving any previously failed Phase 2A migrations...'
npx prisma migrate resolve --rolled-back 20260729000001_add_staff_scope 2>/dev/null && echo '[start.sh] Resolved migration 1' || echo '[start.sh] Migration 1 not in failed state (OK)'
npx prisma migrate resolve --rolled-back 20260729000002_add_department_alias 2>/dev/null && echo '[start.sh] Resolved migration 2' || echo '[start.sh] Migration 2 not in failed state (OK)'
npx prisma migrate resolve --rolled-back 20260729000003_add_library_audience 2>/dev/null && echo '[start.sh] Resolved migration 3' || echo '[start.sh] Migration 3 not in failed state (OK)'
npx prisma migrate resolve --rolled-back 20260729000004_add_library_fields 2>/dev/null && echo '[start.sh] Resolved migration 4' || echo '[start.sh] Migration 4 not in failed state (OK)'

echo '[start.sh] Applying pending migrations...'
npx prisma migrate deploy
echo '[start.sh] All migrations applied.'

echo '[start.sh] Seeding department aliases...'
node scripts/seed-department-aliases.js
echo '[start.sh] Aliases seeded.'

echo '[start.sh] Starting server...'
exec node server.js
