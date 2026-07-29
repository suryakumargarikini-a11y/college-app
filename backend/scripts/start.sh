#!/bin/sh
set -e

# SITAM Smart ERP -- Unsuppressed Diagnostic Recovery Entrypoint
echo '[start.sh] Executing unsuppressed migrate resolve...'
npx prisma migrate resolve --rolled-back 20260729000001_add_staff_scope

echo '[start.sh] Checking migrate status after resolve...'
npx prisma migrate status || true

echo '[start.sh] Starting server without running migrate deploy...'
exec node server.js