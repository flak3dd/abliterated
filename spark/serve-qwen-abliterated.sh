#!/usr/bin/env bash
# One-shot docker run matching docker-compose.qwen-abliterated.yml
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

if [[ ! -d "$MODEL_DIR" ]]; then
  echo "Model dir missing: $MODEL_DIR — run ./pull-model.sh first" >&2
  exit 1
fi

ABS_MODEL="$(cd "$MODEL_DIR" && pwd)"

exec docker run --rm --gpus all --ipc=host --shm-size=16g \
  -p "${PORT}:8000" \
  -v "${ABS_MODEL}:/models/current:ro" \
  -e VLLM_NVFP4_GEMM_BACKEND=marlin \
  -e VLLM_TEST_FORCE_FP8_MARLIN=1 \
  -e VLLM_USE_FLASHINFER_MOE_FP4=0 \
  -e CUTE_DSL_ARCH=sm_121a \
  -e FLASHINFER_DISABLE_VERSION_CHECK=1 \
  "$IMAGE" \
  vllm serve /models/current \
    --host 0.0.0.0 \
    --port 8000 \
    --served-model-name "$SERVED_NAME" \
    --trust-remote-code \
    --reasoning-parser qwen3 \
    --enable-auto-tool-choice \
    --tool-call-parser qwen3_coder \
    --moe-backend marlin \
    --gpu-memory-utilization "$GPU_MEMORY_UTILIZATION" \
    --kv-cache-dtype fp8 \
    --max-model-len 65536 \
    --speculative-config '{"method":"mtp","num_speculative_tokens":3}'
