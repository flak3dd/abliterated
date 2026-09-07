#!/usr/bin/env bash
# Start ComfyUI (:8188) then the uncensored OpenAI image bridge (:7860).
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

chmod +x "$IMAGE_DIR/serve-comfy.sh" "$IMAGE_DIR/serve-spark.sh" 2>/dev/null || true
mkdir -p "$IMAGE_DIR/logs"

if [[ -f "$IMAGE_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$IMAGE_DIR/.env"
  set +a
fi

export ABLITERATED_SPARK_IMAGE="$IMAGE_DIR"
export COMFY_URL="${COMFY_URL:-http://127.0.0.1:8188}"
export FLUX_MODEL_ID="${FLUX_MODEL_ID:-krea2-turbo-nvfp4}"
export COMFY_WORKFLOW="${COMFY_WORKFLOW:-$IMAGE_DIR/workflows/txt2img-krea2-turbo-nvfp4.json}"

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

if ! curl -fsS -m 2 http://127.0.0.1:8188/ >/dev/null 2>&1; then
  echo "Starting ComfyUI on :8188"
  nohup "$IMAGE_DIR/serve-comfy.sh" >>"$IMAGE_DIR/logs/comfy.log" 2>&1 &
  echo $! >"$IMAGE_DIR/logs/comfy.pid"
else
  echo "ComfyUI already answering on :8188"
fi

if ! wait_http "http://127.0.0.1:8188/" 90; then
  echo "ComfyUI did not become ready — check $IMAGE_DIR/logs/comfy.log" >&2
  echo "Image bridge will still start and use direct uncensored FLUX if Comfy is down." >&2
fi

if ! curl -fsS -m 2 http://127.0.0.1:7860/health >/dev/null 2>&1; then
  echo "Starting OpenAI image bridge on :7860 (krea2-turbo-nvfp4 + z-image draft)"
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
    echo "Starting Qwen abliterated vLLM"
    nohup "$TEXT_DIR/serve-qwen-abliterated.sh" >>"$IMAGE_DIR/logs/vllm.log" 2>&1 &
    echo $! >"$IMAGE_DIR/logs/vllm.pid"
  else
    echo "No $TEXT_DIR/serve-qwen-abliterated.sh — skip text" >&2
  fi
fi

echo "Spark image stack up."
echo "  ComfyUI:  http://0.0.0.0:8188"
echo "  Images:   http://0.0.0.0:7860/v1  quality=krea2-turbo-nvfp4  draft=z-image-turbo-nsfw-nvfp4"
