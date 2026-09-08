#!/usr/bin/env bash
# NVIDIA Sync Custom app — Abliterated OpenAI image API (port 7860).
# Settings → Custom → Add New: Name "Abliterated Images", Port 7860,
# leave Auto-open unchecked (API). Paste this file as Launch Script.
# Starts Diffusers Krea 2 RAW bridge only (no ComfyUI / :8188).
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
export SAMPLER_BACKEND="${SAMPLER_BACKEND:-diffusers}"
export FLUX_MODEL_ID="${FLUX_MODEL_ID:-krea2-raw-fp8}"
export FLUX_STEPS="${FLUX_STEPS:-${SAMPLER_STEPS:-24}}"
export SAMPLER_STEPS="${SAMPLER_STEPS:-${FLUX_STEPS:-4}}"
export SAMPLER_GUIDANCE="${SAMPLER_GUIDANCE:-3.5}"
export ABLITERATED_IMAGE_HOST="${ABLITERATED_IMAGE_HOST:-127.0.0.1}"
export ABLITERATED_IMAGE_PORT="${ABLITERATED_IMAGE_PORT:-7860}"
mkdir -p "$IMAGE_DIR/logs"

STARTED_BRIDGE=0
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
  exit 0
}
trap cleanup INT TERM HUP QUIT

bridge_up() { curl -fsS -m 2 http://127.0.0.1:7860/health >/dev/null 2>&1; }

if ! bridge_up; then
  echo "Starting Abliterated image bridge on :7860 (krea2-raw-fp8 Diffusers)"
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
echo "Abliterated Images  http://127.0.0.1:7860/v1  quality=krea2-raw-fp8"
echo "Stop in NVIDIA Sync ends this session (only stops processes this script started)."
while :; do sleep 86400; done
