#!/usr/bin/env bash
# Start the Diffusers Krea 2 RAW OpenAI image bridge (:7860).
# Optional --with-text also starts Qwen vLLM on :8000.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
IMAGE_DIR="${ABLITERATED_SPARK_IMAGE:-$ROOT/spark-image}"
TEXT_DIR="${ABLITERATED_SPARK_TEXT:-$ROOT/spark}"
WITH_TEXT=0
for arg in "$@"; do
  case "$arg" in
    --with-text) WITH_TEXT=1 ;;
  esac
done

chmod +x "$IMAGE_DIR/serve-spark.sh" 2>/dev/null || true
mkdir -p "$IMAGE_DIR/logs"

if [[ -f "$IMAGE_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$IMAGE_DIR/.env"
  set +a
fi

export ABLITERATED_SPARK_IMAGE="$IMAGE_DIR"
export FLUX_MODEL_ID="${FLUX_MODEL_ID:-krea2-raw-fp8}"
export SAMPLER_BACKEND="${SAMPLER_BACKEND:-diffusers}"
export ABLITERATED_IMAGE_HOST="${ABLITERATED_IMAGE_HOST:-127.0.0.1}"
export ABLITERATED_IMAGE_PORT="${ABLITERATED_IMAGE_PORT:-7860}"
export SAMPLER_STEPS="${SAMPLER_STEPS:-24}"
export SAMPLER_GUIDANCE="${SAMPLER_GUIDANCE:-3.5}"
export SAMPLER_SAMPLER="${SAMPLER_SAMPLER:-euler}"
export SAMPLER_SCHEDULER="${SAMPLER_SCHEDULER:-beta}"
export SAMPLER_LORA_STRENGTH="${SAMPLER_LORA_STRENGTH:-0.75}"
export SAMPLER_MAX_EDGE="${SAMPLER_MAX_EDGE:-1536}"

wait_http() {
  local url="$1" n="${2:-60}"
  local i=0
  while (( i < n )); do
    if curl -fsS -m 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
    i=$((i + 1))
  done
  return 1
}

if ! curl -fsS -m 2 http://127.0.0.1:7860/health >/dev/null 2>&1; then
  echo "Starting OpenAI image bridge on :7860 (krea2-raw-fp8 Diffusers)"
  nohup "$IMAGE_DIR/serve-spark.sh" >>"$IMAGE_DIR/logs/bridge.log" 2>&1 &
  echo $! >"$IMAGE_DIR/logs/bridge.pid"
else
  echo "Image bridge already answering on :7860"
fi

if ! wait_http "http://127.0.0.1:7860/health" 45; then
  echo "Image bridge did not become ready — check $IMAGE_DIR/logs/bridge.log" >&2
  exit 1
fi
curl -fsS http://127.0.0.1:7860/health || true
echo

if [[ "$WITH_TEXT" -eq 1 ]]; then
  if [[ -x "$TEXT_DIR/serve-qwen-abliterated.sh" ]]; then
    echo "Starting Qwen abliterated vLLM on :8000"
    mkdir -p "$IMAGE_DIR/logs"
    if ! "$TEXT_DIR/serve-qwen-abliterated.sh" >>"$IMAGE_DIR/logs/vllm.log" 2>&1; then
      echo "Qwen vLLM did not start — check $IMAGE_DIR/logs/vllm.log and spark/.env HF_TOKEN for gated pulls." >&2
    fi
  else
    echo "No $TEXT_DIR/serve-qwen-abliterated.sh — skip text" >&2
  fi
fi

echo "Spark image stack up."
echo "  Images:   http://127.0.0.1:7860/v1  quality=krea2-raw-fp8 (Diffusers)"
if [[ "$WITH_TEXT" -eq 1 ]]; then
  echo "  Text:     http://127.0.0.1:8000/v1  model=qwen-abliterated"
fi
