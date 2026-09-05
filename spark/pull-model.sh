#!/usr/bin/env bash
# Download Qwen abliterated NVFP4-MTP weights onto the DGX Spark host.
# Run on Spark only — do not pull multi-GB weights onto the IDE box.
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a && source .env && set +a
fi

MODEL_REPO="${MODEL_REPO:-THe-Plague/Qwen3.6-35B-A3B-abliterated-NVFP4-MTP}"
MODEL_DIR="${MODEL_DIR:-./models/Qwen3.6-35B-A3B-abliterated-NVFP4-MTP}"

mkdir -p "$(dirname "$MODEL_DIR")"

if command -v hf >/dev/null 2>&1; then
  echo "Using hf download -> $MODEL_DIR"
  hf download "$MODEL_REPO" --local-dir "$MODEL_DIR"
elif command -v huggingface-cli >/dev/null 2>&1; then
  echo "Using huggingface-cli download -> $MODEL_DIR"
  huggingface-cli download "$MODEL_REPO" --local-dir "$MODEL_DIR"
else
  echo "Install Hugging Face CLI first: pip install -U huggingface_hub[cli]" >&2
  exit 1
fi

echo "Done. Weights at $MODEL_DIR"
