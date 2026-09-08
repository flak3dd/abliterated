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

if [[ -n "${HF_TOKEN:-}" ]]; then
  export HF_TOKEN
  export HUGGING_FACE_HUB_TOKEN="$HF_TOKEN"
fi

mkdir -p "$(dirname "$MODEL_DIR")"

hf_fail() {
  echo "Hugging Face download failed for $MODEL_REPO" >&2
  echo "If the repo is gated: create a token, accept the model terms on the HF page," >&2
  echo "then set HF_TOKEN=hf_... in spark/.env and re-run ./pull-model.sh" >&2
  echo "No token is currently set (HF_TOKEN empty). Public repos still download; gated ones 401." >&2
  exit 1
}

if command -v hf >/dev/null 2>&1; then
  echo "Using hf download -> $MODEL_DIR"
  hf download "$MODEL_REPO" --local-dir "$MODEL_DIR" || hf_fail
elif command -v huggingface-cli >/dev/null 2>&1; then
  echo "Using huggingface-cli download -> $MODEL_DIR"
  huggingface-cli download "$MODEL_REPO" --local-dir "$MODEL_DIR" || hf_fail
else
  echo "Install Hugging Face CLI first: pip install -U huggingface_hub[cli]" >&2
  exit 1
fi

if [[ ! -f "$MODEL_DIR/config.json" || ! -f "$MODEL_DIR/model.safetensors" ]]; then
  echo "Download finished but $MODEL_DIR is missing config.json or model.safetensors" >&2
  hf_fail
fi

echo "Done. Weights at $MODEL_DIR"
