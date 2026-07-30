#!/bin/sh
set -e

echo "[ENTRYPOINT] pid=$$ ppid=$PPID time=$(date -Iseconds 2>/dev/null || date)"
echo "[RUNTIME-DIAG] User identity: $(id)"
echo "[RUNTIME-DIAG] Uploads dir details:"
ls -ld uploads 2>/dev/null || true
stat -c '%U %G %u %g %a %n' uploads 2>/dev/null || true

echo '[start.sh] Preparing upload directories...'
mkdir -p uploads/photos uploads/achievements uploads/library 2>/dev/null || true

echo '[start.sh] Upload directories ready.'
echo '[ENTRYPOINT->NODE] pid=$$'
exec node server.js