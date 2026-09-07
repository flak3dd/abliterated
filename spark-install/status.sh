#!/usr/bin/env bash
# Print Spark image / chat endpoint health.
set -euo pipefail
HOST="${1:-127.0.0.1}"
echo "=== image :7860 ==="
curl -fsS -m 5 "http://${HOST}:7860/health" || echo "DOWN"
echo
echo "=== image models ==="
curl -fsS -m 5 "http://${HOST}:7860/v1/models" || echo "DOWN"
echo
echo "=== comfy :8188 ==="
curl -fsS -m 5 -o /dev/null -w "http=%{http_code}\n" "http://${HOST}:8188/" || echo "DOWN"
echo "=== vllm :8000 ==="
curl -fsS -m 5 "http://${HOST}:8000/v1/models" || echo "DOWN"
echo
