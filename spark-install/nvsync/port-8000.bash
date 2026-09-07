#!/usr/bin/env bash
# NVIDIA Sync Custom app — optional Abliterated Qwen vLLM (port 8000).
# Settings → Custom → Add New: Name "Abliterated Qwen", Port 8000,
# Auto-open unchecked. Requires install.sh --with-text.
set -euo pipefail

TEXT_DIR=""
for d in "${ABLITERATED_SPARK_TEXT:-}" \
  "$HOME/abliterated-spark/spark" \
  "$HOME/spark"; do
  if [[ -n "$d" && -x "$d/serve-qwen-abliterated.sh" ]]; then
    TEXT_DIR="$d"
    break
  fi
done
if [[ -z "$TEXT_DIR" ]]; then
  echo "Qwen stack not installed. Re-run: bash spark-install/push.sh <alias> --start --with-text" >&2
  exit 1
fi

STARTED=0
LOG_DIR="${ABLITERATED_SPARK_IMAGE:-$HOME/abliterated-spark/spark-image}/logs"
mkdir -p "$LOG_DIR"
PID_FILE="$LOG_DIR/nvsync-8000.pid"

cleanup() {
  if [[ "$STARTED" -eq 1 && -f "$PID_FILE" ]]; then
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi
  exit 0
}
trap cleanup INT TERM HUP QUIT

listening() { curl -fsS -m 2 http://127.0.0.1:8000/v1/models >/dev/null 2>&1; }

if listening; then
  echo "Qwen vLLM already on :8000"
else
  echo "Starting qwen-abliterated on :8000"
  chmod +x "$TEXT_DIR/serve-qwen-abliterated.sh"
  nohup "$TEXT_DIR/serve-qwen-abliterated.sh" >>"$LOG_DIR/vllm.log" 2>&1 &
  echo $! >"$PID_FILE"
  STARTED=1
fi

echo "Abliterated Qwen http://127.0.0.1:8000/v1  model=qwen-abliterated"
while :; do sleep 86400; done
