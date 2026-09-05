#!/usr/bin/env bash
# Download FLUX.2 Klein base + abliterated text encoder on the GPU host.
# Does not run on the IDE box by design.
set -euo pipefail
cd "$(dirname "$0")"
if [[ -f .env ]]; then set -a; source .env; set +a; fi
BASE="${FLUX_BASE_REPO:-black-forest-labs/FLUX.2-klein-base-4B}"
ENC="${FLUX_TEXT_ENCODER_REPO:-PinoCookie/Flux.2-klein-4B-abliterated-text-encoder}"
echo "Pulling base: $BASE"
echo "Pulling text encoder: $ENC"
if command -v huggingface-cli >/dev/null 2>&1; then
  huggingface-cli download "$BASE"
  huggingface-cli download "$ENC"
elif command -v hf >/dev/null 2>&1; then
  hf download "$BASE"
  hf download "$ENC"
else
  echo "Install huggingface_hub CLI (pip install -U huggingface_hub) then re-run." >&2
  exit 1
fi
echo "Done. Start: python serve-openai-bridge.py"
