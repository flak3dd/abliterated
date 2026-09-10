#!/usr/bin/env bash
# Download gpt-oss-120b-abliterated MXFP4 onto the DGX Spark host (~65 GB).
# Run on Spark only — do not pull weights onto the IDE box.
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a && source .env && set +a
fi

MODEL_REPO="${GPT_OSS_MODEL_REPO:-batsclamp/Huihui-gpt-oss-120b-mxfp4-abliterated}"
MODEL_DIR="${GPT_OSS_MODEL_DIR:-./models/Huihui-gpt-oss-120b-mxfp4-abliterated}"

if [[ -n "${HF_TOKEN:-}" ]]; then
  export HF_TOKEN
  export HUGGING_FACE_HUB_TOKEN="$HF_TOKEN"
fi

mkdir -p "$(dirname "$MODEL_DIR")"

hf_fail() {
  echo "Hugging Face download failed for $MODEL_REPO" >&2
  echo "If the repo is gated: create a token, accept the model terms on the HF page," >&2
  echo "then set HF_TOKEN=hf_... in spark/.env and re-run $0" >&2
  exit 1
}

HF_BIN=""
if [[ -x "$(dirname "$0")/.venv/bin/hf" ]]; then
  HF_BIN="$(dirname "$0")/.venv/bin/hf"
elif command -v hf >/dev/null 2>&1; then
  HF_BIN="$(command -v hf)"
fi

echo "Downloading $MODEL_REPO -> $MODEL_DIR (~65 GB MXFP4)"
if [[ -n "$HF_BIN" ]]; then
  "$HF_BIN" download "$MODEL_REPO" --local-dir "$MODEL_DIR" --max-workers 8 || hf_fail
elif command -v huggingface-cli >/dev/null 2>&1; then
  huggingface-cli download "$MODEL_REPO" --local-dir "$MODEL_DIR" || hf_fail
else
  echo "Install Hugging Face CLI first: pip install -U huggingface_hub[cli]" >&2
  exit 1
fi

if [[ ! -f "$MODEL_DIR/config.json" || ! -f "$MODEL_DIR/model.safetensors.index.json" ]]; then
  echo "Download incomplete: $MODEL_DIR (need config.json + model.safetensors.index.json)" >&2
  exit 1
fi

echo "✓ Downloaded"
echo "  path: $(cd "$MODEL_DIR" && pwd)"
echo "  serve: ./serve-gpt-oss-120b-abliterated.sh  (stops qwen-abliterated on :8000)"
