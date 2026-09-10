#!/usr/bin/env bash
# Serve Qwen abliterated via docker compose. Image ENTRYPOINT is already
# `vllm serve` — do not pass those two words again.
# Run on DGX Spark (GB10 / sm_121a). Binds OpenAI HTTP on 0.0.0.0:8000.
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a && source .env && set +a
fi

IMAGE="${IMAGE:-vllm/vllm-openai:cu130-nightly}"
MODEL_DIR="${MODEL_DIR:-./models/Qwen3.6-35B-A3B-abliterated-NVFP4-MTP}"
PORT="${PORT:-8000}"
SERVED_NAME="${SERVED_NAME:-qwen-abliterated}"
GPU_MEMORY_UTILIZATION="${GPU_MEMORY_UTILIZATION:-0.6}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.qwen-abliterated.yml}"

if [[ ! -f "$MODEL_DIR/config.json" || ! -f "$MODEL_DIR/model.safetensors" ]]; then
  echo "Model dir incomplete: $MODEL_DIR" >&2
  echo "Need config.json + model.safetensors. Run ./pull-model.sh on the Spark." >&2
  if [[ -z "${HF_TOKEN:-}" ]]; then
    echo "No HF_TOKEN in spark/.env. Gated Hugging Face repos need a token and accepted terms:" >&2
    echo "  1. Create a token at https://huggingface.co/settings/tokens" >&2
    echo "  2. Open the model page and Accept the license" >&2
    echo "  3. Put HF_TOKEN=hf_... in spark/.env  (never commit it)" >&2
    echo "  4. ./pull-model.sh && ./serve-qwen-abliterated.sh" >&2
  fi
  exit 1
fi

if command -v docker >/dev/null 2>&1 && [[ -f "$COMPOSE_FILE" ]]; then
  echo "Starting qwen-abliterated via $COMPOSE_FILE (entrypoint is vllm serve; command is the model path)"
  exec docker compose -f "$COMPOSE_FILE" up -d --force-recreate --remove-orphans
fi

ABS_MODEL="$(cd "$MODEL_DIR" && pwd)"
echo "compose missing — docker run fallback"
exec docker run --rm --gpus all --ipc=host --shm-size=16g \
  -p "${PORT}:8000" \
  -v "${ABS_MODEL}:/models/current:ro" \
  -e VLLM_NVFP4_GEMM_BACKEND=marlin \
  -e VLLM_TEST_FORCE_FP8_MARLIN=1 \
  -e VLLM_USE_FLASHINFER_MOE_FP4=0 \
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
    --reasoning-parser qwen3 \
    --enable-auto-tool-choice \
    --tool-call-parser qwen3_coder \
    --gpu-memory-utilization "$GPU_MEMORY_UTILIZATION" \
    --kv-cache-dtype fp8 \
    --max-model-len 65536 \
    --speculative-config '{"method":"mtp","num_speculative_tokens":3}'
