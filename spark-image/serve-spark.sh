#!/usr/bin/env bash
# Run the OpenAI image bridge on DGX Spark (GB10 / aarch64 / CUDA 13).
# Binds 0.0.0.0:7860 so the Abliterated IDE on the LAN can reach it.
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export ABLITERATED_IMAGE_HOST="${ABLITERATED_IMAGE_HOST:-0.0.0.0}"
export ABLITERATED_IMAGE_PORT="${ABLITERATED_IMAGE_PORT:-7860}"
# ComfyUI on :8188 runs Krea 2 Turbo NVFP4 + uncensor LoRA (default) and Z-Image Turbo NVFP4 (draft).
export COMFY_URL="${COMFY_URL:-http://127.0.0.1:8188}"
export FLUX_MODEL_ID="${FLUX_MODEL_ID:-krea2-turbo-nvfp4}"
export COMFY_MODEL_ID="${COMFY_MODEL_ID:-krea2-turbo-nvfp4}"
export COMFY_WORKFLOW="${COMFY_WORKFLOW:-$(cd "$(dirname "$0")" && pwd)/workflows/txt2img-krea2-turbo-nvfp4.json}"
export ABLITERATED_SPARK_IMAGE="${ABLITERATED_SPARK_IMAGE:-$(cd "$(dirname "$0")" && pwd)}"
export TRITON_PTXAS_PATH="${TRITON_PTXAS_PATH:-/usr/local/cuda/bin/ptxas}"
export TORCH_FLOAT32_MATMUL_PRECISION="${TORCH_FLOAT32_MATMUL_PRECISION:-high}"
# Triton compiles cuda_utils.c at first generate; Spark images often lack python3-dev.
if [[ -d "${HOME}/opt/python-dev/usr/include/python3.12" ]]; then
  PYINC="${HOME}/opt/python-dev/usr/include"
  export CPATH="${PYINC}:${PYINC}/python3.12${CPATH:+:$CPATH}"
  export C_INCLUDE_PATH="${PYINC}:${PYINC}/python3.12${C_INCLUDE_PATH:+:$C_INCLUDE_PATH}"
fi

VENV="${VENV:-./.venv}"
if [[ ! -x "$VENV/bin/python" ]]; then
  echo "Missing $VENV — create it on the Spark:" >&2
  echo "  python3 -m venv .venv" >&2
  echo "  .venv/bin/pip install torch torchvision --index-url https://download.pytorch.org/whl/cu130" >&2
  echo "  .venv/bin/pip install fastapi 'uvicorn[standard]' pydantic diffusers transformers accelerate safetensors Pillow huggingface_hub" >&2
  exit 1
fi

exec "$VENV/bin/python" serve-openai-bridge.py
