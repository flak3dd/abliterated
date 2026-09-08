#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[[ -f .env ]] && { set -a; source .env; set +a; }
export ABLITERATED_IMAGE_HOST="${ABLITERATED_IMAGE_HOST:-127.0.0.1}"
export ABLITERATED_IMAGE_PORT="${ABLITERATED_IMAGE_PORT:-7860}"
export SAMPLER_BACKEND="${SAMPLER_BACKEND:-diffusers}"
export FLUX_MODEL_ID="${FLUX_MODEL_ID:-${IMAGE_MODEL_ID:-krea2-raw-fp8}}"
export IMAGE_MODEL_ID="${IMAGE_MODEL_ID:-$FLUX_MODEL_ID}"
export SAMPLER_STEPS="${SAMPLER_STEPS:-24}"
export FLUX_STEPS="${FLUX_STEPS:-$SAMPLER_STEPS}"
export SAMPLER_GUIDANCE="${SAMPLER_GUIDANCE:-3.5}"
export SAMPLER_SAMPLER="${SAMPLER_SAMPLER:-euler}"
export SAMPLER_SCHEDULER="${SAMPLER_SCHEDULER:-beta}"
export SAMPLER_LORA_STRENGTH="${SAMPLER_LORA_STRENGTH:-0.75}"
export SAMPLER_MAX_EDGE="${SAMPLER_MAX_EDGE:-1536}"
export SPARK_IMAGE_MODELS="${SPARK_IMAGE_MODELS:-$PWD/models}"
export ABLITERATED_SPARK_IMAGE="${ABLITERATED_SPARK_IMAGE:-$PWD}"
VENV="${VENV:-./.venv}"
[[ -x "$VENV/bin/python" ]] || { echo "Missing $VENV — pip install -r requirements.txt (diffusers>=0.39)" >&2; exit 1; }
exec "$VENV/bin/python" serve-openai-bridge.py
