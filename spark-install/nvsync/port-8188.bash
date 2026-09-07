#!/usr/bin/env bash
# NVIDIA Sync Custom app — Abliterated ComfyUI (port 8188).
# Settings → Custom → Add New: Name "Abliterated ComfyUI", Port 8188,
# Auto-open in browser at path "/". Paste this file as Launch Script.
set -euo pipefail

IMAGE_DIR=""
for d in "${ABLITERATED_SPARK_IMAGE:-}" \
  "$HOME/abliterated-spark/spark-image" \
  "$HOME/spark-image"; do
  if [[ -n "$d" && -x "$d/.venv/bin/python" && -f "$d/serve-comfy.sh" ]]; then
    IMAGE_DIR="$d"
    break
  fi
done
if [[ -z "$IMAGE_DIR" ]]; then
  echo "Abliterated Spark image stack not installed." >&2
  echo "On the Mac: bash spark-install/push.sh <sync-alias> --start" >&2
  exit 1
fi

export ABLITERATED_SPARK_IMAGE="$IMAGE_DIR"
export COMFY_VENV="${COMFY_VENV:-$IMAGE_DIR/.venv}"
export COMFY_ROOT="${COMFY_ROOT:-$HOME/ComfyUI}"
mkdir -p "$IMAGE_DIR/logs"

STARTED=0
PID_FILE="$IMAGE_DIR/logs/nvsync-8188.pid"

cleanup() {
  if [[ "$STARTED" -eq 1 && -f "$PID_FILE" ]]; then
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "Stopping ComfyUI pid $pid (started by this Sync app)"
      kill "$pid" 2>/dev/null || true
      sleep 0.4
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi
  exit 0
}
trap cleanup INT TERM HUP QUIT

listening() { curl -fsS -m 2 http://127.0.0.1:8188/ >/dev/null 2>&1; }

if listening; then
  echo "ComfyUI already on :8188 — keeping the Sync tunnel. Stop in Sync closes the tunnel only."
else
  echo "Starting Abliterated ComfyUI on :8188"
  chmod +x "$IMAGE_DIR/serve-comfy.sh"
  nohup "$IMAGE_DIR/serve-comfy.sh" >>"$IMAGE_DIR/logs/comfy.log" 2>&1 &
  echo $! >"$PID_FILE"
  STARTED=1
  for _ in $(seq 1 90); do
    listening && break
    sleep 2
  done
  if ! listening; then
    echo "ComfyUI did not become ready. Tail $IMAGE_DIR/logs/comfy.log" >&2
    exit 1
  fi
fi

echo "Abliterated ComfyUI http://127.0.0.1:8188  (Krea 2 Turbo NVFP4 + Z-Image Turbo NVFP4)"
echo "Stop in NVIDIA Sync ends this session."
while :; do sleep 86400; done
