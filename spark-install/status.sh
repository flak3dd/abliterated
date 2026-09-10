#!/usr/bin/env bash
# Print Spark image / chat endpoint health.
set -euo pipefail
HOST="${1:-127.0.0.1}"
# Reject shell/url metacharacters — host is interpolated into curl URLs.
if [[ ! "$HOST" =~ ^[A-Za-z0-9._:-]+$ ]]; then
  echo "Invalid host: use hostname/IP only" >&2
  exit 2
fi
echo "=== image :7860 ==="
curl -fsS -m 5 "http://${HOST}:7860/health" || echo "DOWN"
echo
echo "=== image models ==="
curl -fsS -m 5 "http://${HOST}:7860/v1/models" || echo "DOWN"
echo
echo "=== vllm :8000 ==="
curl -fsS -m 5 "http://${HOST}:8000/v1/models" || echo "DOWN"
echo
