#!/bin/bash
# Prefer LaunchAgent (ai.abliteration.bridge). This loop is a fallback if launchd is unavailable.
ROOT="/Users/adminuser/abliterated"
NODE="/opt/homebrew/bin/node"
LOG="/tmp/ablit-bridge.log"
cd "$ROOT" || exit 1
while true; do
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) starting bridge" >> "$LOG"
  "$NODE" daemon/bridge.js >> "$LOG" 2>&1
  code=$?
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) bridge exited code=$code" >> "$LOG"
  sleep 1
done
