#!/usr/bin/env bash
# Stop Abliterated Spark image (and optional vLLM) processes started by start.sh.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
IMAGE_DIR="${ABLITERATED_SPARK_IMAGE:-$ROOT/spark-image}"
LOG="$IMAGE_DIR/logs"

kill_pidfile() {
  local f="$1"
  if [[ -f "$f" ]]; then
    local pid
    pid="$(cat "$f" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 0.4
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$f"
  fi
}

kill_pidfile "$LOG/comfy.pid"
kill_pidfile "$LOG/bridge.pid"
kill_pidfile "$LOG/vllm.pid"
pkill -f "serve-openai-bridge.py" 2>/dev/null || true
pkill -f "ComfyUI/main.py" 2>/dev/null || true
echo "Spark image stack stopped."
