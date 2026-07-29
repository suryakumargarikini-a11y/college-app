#!/bin/sh
set -e

# SITAM Smart ERP -- Pure Diagnostic Recovery Entrypoint
echo '[start.sh] Step 1: Executing unsuppressed migrate resolve...'
npx prisma migrate resolve --rolled-back 20260729000001_add_staff_scope

echo '[start.sh] Step 2: Checking migrate status after resolve...'
npx prisma migrate status

echo '[start.sh] Diagnostic recovery complete. Exiting start.sh cleanly (server.js withheld).'
exit 0