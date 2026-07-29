#!/bin/sh

# SITAM Smart ERP -- One-time recovery entrypoint for Railway
echo '[start.sh] Step 1: Resolving failed migration 20260729000001_add_staff_scope...'
npx prisma migrate resolve --rolled-back 20260729000001_add_staff_scope || true

echo '[start.sh] Step 2: Applying pending migrations...'
npx prisma migrate deploy

echo '[start.sh] Step 3: Starting server...'
exec node server.js