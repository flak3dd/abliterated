#!/usr/bin/env bash
# Launch ComfyUI on DGX Spark (NVIDIA playbook: --listen 0.0.0.0, port 8188).
set -euo pipefail
ROOT="${COMFY_ROOT:-$HOME/ComfyUI}"
VENV="${COMFY_VENV:-$HOME/spark-image/.venv}"
export TRITON_PTXAS_PATH="${TRITON_PTXAS_PATH:-/usr/local/cuda/bin/ptxas}"
export TORCH_FLOAT32_MATMUL_PRECISION="${TORCH_FLOAT32_MATMUL_PRECISION:-high}"
if [[ -d "${HOME}/opt/python-dev/usr/include/python3.12" ]]; then
  PYINC="${HOME}/opt/python-dev/usr/include"
  export CPATH="${PYINC}:${PYINC}/python3.12${CPATH:+:$CPATH}"
  export C_INCLUDE_PATH="${PYINC}:${PYINC}/python3.12${C_INCLUDE_PATH:+:$C_INCLUDE_PATH}"
fi
if [[ ! -x "$VENV/bin/python" ]]; then
  echo "Missing venv $VENV" >&2
  exit 1
fi
if [[ ! -f "$ROOT/main.py" ]]; then
  echo "Missing ComfyUI at $ROOT — clone v0.28.2 first" >&2
  exit 1
fi
export ABLITERATED_SPARK_IMAGE="${ABLITERATED_SPARK_IMAGE:-$HOME/abliterated-spark/spark-image}"
if [[ ! -d "$ABLITERATED_SPARK_IMAGE" && -d "$(cd "$(dirname "$0")" && pwd)" ]]; then
  export ABLITERATED_SPARK_IMAGE="$(cd "$(dirname "$0")" && pwd)"
fi
cd "$ROOT"
exec "$VENV/bin/python" main.py --listen 0.0.0.0 --port "${COMFY_PORT:-8188}" --enable-cors-header '*'
