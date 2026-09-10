#!/usr/bin/env bash
# Serve gpt-oss-120b-abliterated MXFP4 via docker compose.
# Image ENTRYPOINT is already `vllm serve` — do not pass those two words again.
# Replaces qwen-abliterated on :8000 (one text model at a time).
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a && source .env && set +a
fi

IMAGE="${IMAGE:-vllm/vllm-openai:cu130-nightly}"
MODEL_DIR="${GPT_OSS_MODEL_DIR:-./models/Huihui-gpt-oss-120b-mxfp4-abliterated}"
PORT="${PORT:-8000}"
SERVED_NAME="${GPT_OSS_SERVED_NAME:-gpt-oss-120b-abliterated}"
GPU_MEMORY_UTILIZATION="${GPT_OSS_GPU_MEMORY_UTILIZATION:-0.70}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.gpt-oss-120b-abliterated.yml}"

if [[ ! -f "$MODEL_DIR/config.json" || ! -f "$MODEL_DIR/model.safetensors.index.json" ]]; then
  echo "Model dir incomplete: $MODEL_DIR" >&2
  echo "Need config.json + model.safetensors.index.json. Run ./pull-gpt-oss-120b.sh on the Spark." >&2
  exit 1
fi

export IMAGE MODEL_DIR PORT SERVED_NAME GPU_MEMORY_UTILIZATION

if command -v docker >/dev/null 2>&1; then
  docker rm -f qwen-abliterated gpt-oss-120b-abliterated >/dev/null 2>&1 || true
fi

if command -v docker >/dev/null 2>&1 && [[ -f "$COMPOSE_FILE" ]]; then
  echo "Starting gpt-oss-120b-abliterated via $COMPOSE_FILE (entrypoint is vllm serve; command is the model path)"
  exec docker compose -f "$COMPOSE_FILE" up -d --force-recreate --remove-orphans
fi

ABS_MODEL="$(cd "$MODEL_DIR" && pwd)"
echo "compose missing — docker run fallback"
exec docker run --rm --gpus all --ipc=host --shm-size=16g \
  -p "${PORT}:8000" \
  -v "${ABS_MODEL}:/models/current:ro" \
  -e VLLM_USE_FLASHINFER_MOE_MXFP4_MXFP8=1 \
  -e CUTE_DSL_ARCH=sm_121a \
  -e FLASHINFER_DISABLE_VERSION_CHECK=1 \
  -e HUGGING_FACE_HUB_TOKEN="${HF_TOKEN:-}" \
  -e HF_TOKEN="${HF_TOKEN:-}" \
  "$IMAGE" \
  /models/current \
    --host 0.0.0.0 \
    --port 8000 \
    --served-model-name "$SERVED_NAME" \
    --trust-remote-code \
    --reasoning-parser openai_gptoss \
    --enable-auto-tool-choice \
    --tool-call-parser openai \
    --quantization mxfp4 \
    --gpu-memory-utilization "$GPU_MEMORY_UTILIZATION" \
    --kv-cache-dtype fp8 \
    --max-model-len 131072 \
    --enable-prefix-caching
