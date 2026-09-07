#!/usr/bin/env bash
# Abliterated Spark installer — run ON the DGX Spark (GB10 / aarch64 / CUDA 13).
# Installs ComfyUI + Krea 2 Turbo NVFP4 (uncensor LoRA) as the default generator
# and Z-Image Turbo NSFW NVFP4 as the high-volume draft model.
# Optional --with-text pulls Qwen abliterated vLLM.
# Never run the weight pull on the IDE / laptop.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
IMAGE_DIR="${ABLITERATED_SPARK_IMAGE:-$ROOT/spark-image}"
TEXT_DIR="${ABLITERATED_SPARK_TEXT:-$ROOT/spark}"
COMFY_ROOT="${COMFY_ROOT:-$HOME/ComfyUI}"
COMFY_VERSION="${COMFY_VERSION:-}"
VENV="${COMFY_VENV:-$IMAGE_DIR/.venv}"
WITH_TEXT=0
DO_START=0
SKIP_PULL=0

usage() {
  cat <<'EOF'
Usage: install.sh [--with-text] [--start] [--skip-pull]

  --with-text   Also install the Qwen abliterated vLLM stack (spark/)
  --start       Start ComfyUI + OpenAI image bridge after install
  --skip-pull   Skip Hugging Face weight downloads (reuse cache)

Run this on the Spark host after spark-install/push.sh copies the package.
Image gen: krea2-turbo-nvfp4 (default) + z-image-turbo-nsfw-nvfp4 (draft). Uncensored only.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-text) WITH_TEXT=1; shift ;;
    --start) DO_START=1; shift ;;
    --skip-pull) SKIP_PULL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ ! -f "$IMAGE_DIR/serve-openai-bridge.py" || ! -f "$IMAGE_DIR/uncensored_flux.py" ]]; then
  echo "Missing spark-image next to spark-install." >&2
  echo "Expected $IMAGE_DIR/serve-openai-bridge.py" >&2
  echo "From a Mac/IDE: bash spark-install/push.sh <nvidia-sync-ssh-alias>" >&2
  exit 1
fi

arch="$(uname -m)"
if [[ "$arch" != "aarch64" && "$arch" != "arm64" ]]; then
  echo "This installer targets DGX Spark (aarch64). Found arch=$arch" >&2
  echo "You can still proceed if this is a CUDA 13 ARM box; Ctrl-C to abort." >&2
  sleep 2
fi

if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "nvidia-smi not found — GPU driver is required." >&2
  exit 1
fi
nvidia-smi -L || true

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required" >&2
  exit 1
fi

chmod +x "$HERE"/*.sh "$IMAGE_DIR"/serve-*.sh "$IMAGE_DIR"/pull-models.sh 2>/dev/null || true
if [[ -f "$TEXT_DIR/pull-model.sh" ]]; then
  chmod +x "$TEXT_DIR"/pull-model.sh "$TEXT_DIR"/serve-qwen-abliterated.sh 2>/dev/null || true
fi

mkdir -p "$IMAGE_DIR/logs" "$HOME/opt"

ensure_python_headers() {
  python3 - <<'PY' && return 0
import os, sysconfig, sys
inc = sysconfig.get_path("include") or ""
ok = os.path.isfile(os.path.join(inc, "Python.h"))
sys.exit(0 if ok else 1)
PY
  local dest="$HOME/opt/python-dev"
  if [[ -f "$dest/usr/include/python3.12/Python.h" ]]; then
    echo "Using extracted Python headers in $dest"
    return 0
  fi
  echo "Python.h missing — extracting python3.12-dev debs into $dest (no sudo)"
  mkdir -p "$dest/debs"
  (
    cd "$dest/debs"
    apt-get download python3.12-dev libpython3.12-dev 2>/dev/null || \
      apt-get download python3-dev 2>/dev/null || true
    shopt -s nullglob
    for deb in *.deb; do
      dpkg-deb -x "$deb" "$dest"
    done
  )
}

ensure_python_headers || true
if [[ -d "$HOME/opt/python-dev/usr/include/python3.12" ]]; then
  PYINC="$HOME/opt/python-dev/usr/include"
  export CPATH="${PYINC}:${PYINC}/python3.12${CPATH:+:$CPATH}"
  export C_INCLUDE_PATH="${PYINC}:${PYINC}/python3.12${C_INCLUDE_PATH:+:$C_INCLUDE_PATH}"
fi
export TRITON_PTXAS_PATH="${TRITON_PTXAS_PATH:-/usr/local/cuda/bin/ptxas}"
export TORCH_FLOAT32_MATMUL_PRECISION="${TORCH_FLOAT32_MATMUL_PRECISION:-high}"

if [[ ! -x "$VENV/bin/python" ]]; then
  echo "Creating venv $VENV"
  python3 -m venv "$VENV"
fi

echo "Installing torch (CUDA 13) + image stack into $VENV"
"$VENV/bin/pip" install --upgrade pip wheel
"$VENV/bin/pip" install torch torchvision --index-url https://download.pytorch.org/whl/cu130
"$VENV/bin/pip" install -r "$IMAGE_DIR/requirements.txt"
"$VENV/bin/python" - <<'PY'
import torch
print("torch", torch.__version__, "cuda", torch.cuda.is_available(),
      torch.cuda.get_device_name(0) if torch.cuda.is_available() else None)
if not torch.cuda.is_available():
    raise SystemExit("torch CUDA is False — aborting Spark image install")
PY

if [[ ! -f "$COMFY_ROOT/main.py" ]]; then
  echo "Cloning ComfyUI ${COMFY_VERSION:-latest} -> $COMFY_ROOT"
  if [[ -n "$COMFY_VERSION" ]]; then
    git clone --branch "$COMFY_VERSION" --depth 1 https://github.com/comfyanonymous/ComfyUI.git "$COMFY_ROOT"
  else
    git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git "$COMFY_ROOT"
  fi
fi
"$VENV/bin/pip" install -r "$COMFY_ROOT/requirements.txt"
# Keep the Spark cu130 torch if Comfy requirements tried to replace it.
"$VENV/bin/pip" install torch torchvision --index-url https://download.pytorch.org/whl/cu130

if [[ "$SKIP_PULL" -eq 0 ]]; then
  echo "Pulling Krea 2 Turbo NVFP4 + uncensor LoRA + Z-Image Turbo NVFP4 (GPU host only)"
  if [[ -f "$IMAGE_DIR/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$IMAGE_DIR/.env"
    set +a
  elif [[ -f "$HERE/env.example" && ! -f "$IMAGE_DIR/.env" ]]; then
    cp "$HERE/env.example" "$IMAGE_DIR/.env"
  fi
  PATH="$VENV/bin:$PATH" "$IMAGE_DIR/pull-models.sh"
else
  echo "Skipping weight pull (--skip-pull)"
fi

if [[ "$WITH_TEXT" -eq 1 ]]; then
  if [[ ! -d "$TEXT_DIR" ]]; then
    echo "--with-text requested but $TEXT_DIR missing" >&2
    exit 1
  fi
  echo "Pulling Qwen abliterated NVFP4 weights"
  if [[ ! -f "$TEXT_DIR/.env" && -f "$TEXT_DIR/.env.example" ]]; then
    cp "$TEXT_DIR/.env.example" "$TEXT_DIR/.env"
  fi
  "$TEXT_DIR/pull-model.sh"
fi

cat > "$HERE/installed.json" <<EOF
{
  "ok": true,
  "imageDir": "$IMAGE_DIR",
  "comfyRoot": "$COMFY_ROOT",
  "venv": "$VENV",
  "imageModel": "krea2-turbo-nvfp4",
  "draftModel": "z-image-turbo-nsfw-nvfp4",
  "uncensoredOnly": true,
  "withText": $([[ "$WITH_TEXT" -eq 1 ]] && echo true || echo false)
}
EOF

echo "Install complete."
echo "  ComfyUI UI:  http://<spark-ip>:8188"
echo "  OpenAI images: http://<spark-ip>:7860/v1"
echo "    quality krea2-turbo-nvfp4   draft z-image-turbo-nsfw-nvfp4"
if [[ "$WITH_TEXT" -eq 1 ]]; then
  echo "  vLLM chat:   http://<spark-ip>:8000/v1   model=qwen-abliterated"
fi
echo "Start:  $HERE/start.sh"

if [[ "$DO_START" -eq 1 ]]; then
  exec "$HERE/start.sh"
fi
