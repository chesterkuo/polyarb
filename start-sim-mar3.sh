#!/bin/bash
# Wait until 6:55 PM ET on Mar 3, then launch the sim
TARGET="2026-03-03 18:55:00"
TARGET_TS=$(TZ="America/New_York" date -d "$TARGET" +%s)
NOW_TS=$(date +%s)
WAIT=$((TARGET_TS - NOW_TS))

if [ $WAIT -gt 0 ]; then
  echo "[$(TZ='America/New_York' date)] Sleeping $((WAIT / 3600))h $((WAIT % 3600 / 60))m until $TARGET ET..."
  sleep $WAIT
fi

echo "[$(TZ='America/New_York' date)] Launching tonight-sim..."
cd /home/ubuntu/source/polyarb
exec bun run src/tonight-sim.ts
