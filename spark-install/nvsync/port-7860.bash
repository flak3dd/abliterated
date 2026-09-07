#!/usr/bin/env bash
# NVIDIA Sync Custom app — Abliterated OpenAI image API (port 7860).
# Settings → Custom → Add New: Name "Abliterated Images", Port 7860,
# leave Auto-open unchecked (API). Paste this file as Launch Script.
# Starts ComfyUI :8188 first if needed, then the OpenAI bridge.
set -euo pipefail

IMAGE_DIR=""
for d in "${ABLITERATED_SPARK_IMAGE:-}" \
  "$HOME/abliterated-spark/spark-image" \
  "$HOME/spark-image"; do
  if [[ -n "$d" && -x "$d/.venv/bin/python" && -f "$d/serve-spark.sh" ]]; then
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
export COMFY_URL="${COMFY_URL:-http://127.0.0.1:8188}"
export FLUX_MODEL_ID="${FLUX_MODEL_ID:-krea2-raw-fp8}"
export COMFY_STEPS="${COMFY_STEPS:-24}"
export COMFY_CFG="${COMFY_CFG:-3.5}"
export COMFY_SAMPLER="${COMFY_SAMPLER:-euler}"
export COMFY_SCHEDULER="${COMFY_SCHEDULER:-beta}"
export COMFY_LORA_STRENGTH="${COMFY_LORA_STRENGTH:-0.75}"
export COMFY_WORKFLOW="${COMFY_WORKFLOW:-$IMAGE_DIR/workflows/txt2img-krea2-raw-fp8.json}"
mkdir -p "$IMAGE_DIR/logs"

STARTED_COMFY=0
STARTED_BRIDGE=0
COMFY_PID="$IMAGE_DIR/logs/nvsync-8188.pid"
BRIDGE_PID="$IMAGE_DIR/logs/nvsync-7860.pid"

cleanup() {
  if [[ "$STARTED_BRIDGE" -eq 1 && -f "$BRIDGE_PID" ]]; then
    pid="$(cat "$BRIDGE_PID" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "Stopping image bridge pid $pid"
      kill "$pid" 2>/dev/null || true
      sleep 0.4
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$BRIDGE_PID"
  fi
  if [[ "$STARTED_COMFY" -eq 1 && -f "$COMFY_PID" ]]; then
    pid="$(cat "$COMFY_PID" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "Stopping ComfyUI pid $pid"
      kill "$pid" 2>/dev/null || true
      sleep 0.4
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$COMFY_PID"
  fi
  exit 0
}
trap cleanup INT TERM HUP QUIT

comfy_up() { curl -fsS -m 2 http://127.0.0.1:8188/ >/dev/null 2>&1; }
bridge_up() { curl -fsS -m 2 http://127.0.0.1:7860/health >/dev/null 2>&1; }

if ! comfy_up; then
  echo "Starting ComfyUI on :8188 (needed by the image bridge)"
  chmod +x "$IMAGE_DIR/serve-comfy.sh"
  nohup "$IMAGE_DIR/serve-comfy.sh" >>"$IMAGE_DIR/logs/comfy.log" 2>&1 &
  echo $! >"$COMFY_PID"
  STARTED_COMFY=1
  for _ in $(seq 1 90); do
    comfy_up && break
    sleep 2
  done
  if ! comfy_up; then
    echo "ComfyUI did not become ready. Tail $IMAGE_DIR/logs/comfy.log" >&2
    exit 1
  fi
else
  echo "ComfyUI already on :8188"
fi

if ! bridge_up; then
  echo "Starting Abliterated image bridge on :7860 (krea2-raw-fp8 + turbo fast + z-image draft)"
  chmod +x "$IMAGE_DIR/serve-spark.sh"
  nohup "$IMAGE_DIR/serve-spark.sh" >>"$IMAGE_DIR/logs/bridge.log" 2>&1 &
  echo $! >"$BRIDGE_PID"
  STARTED_BRIDGE=1
  for _ in $(seq 1 45); do
    bridge_up && break
    sleep 2
  done
  if ! bridge_up; then
    echo "Image bridge did not become ready. Tail $IMAGE_DIR/logs/bridge.log" >&2
    exit 1
  fi
else
  echo "Image bridge already on :7860"
fi

curl -fsS http://127.0.0.1:7860/health || true
echo
echo "Abliterated Images  http://127.0.0.1:7860/v1"
echo "  quality krea2-raw-fp8   fast krea2-turbo-nvfp4   draft z-image-turbo-nsfw-nvfp4"
echo "Stop in NVIDIA Sync ends this session (only stops processes this script started)."
while :; do sleep 86400; done
