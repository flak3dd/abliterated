#!/usr/bin/env bash
# Copy the Abliterated Spark package from this Mac/IDE to a Spark host over SSH
# (NVIDIA Sync alias such as `flak3dd`, or any Host in ~/.ssh/config).
# Does NOT download GPU weights onto this machine.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
ALIAS="${1:-}"
shift || true
DO_INSTALL=1
DO_START=0
SKIP_PULL=0
WITH_TEXT=0
REMOTE_DIR="${SPARK_REMOTE_DIR:-~/abliterated-spark}"

usage() {
  cat <<'EOF'
Usage: push.sh <ssh-alias> [--no-install] [--start] [--skip-pull] [--with-text]

  ssh-alias     NVIDIA Sync / ssh Host (required), e.g. gx10 or flak3dd
  --no-install  Copy files only; do not run install.sh on the Spark
  --start       After install, start ComfyUI + image bridge
  --skip-pull   Skip Hugging Face downloads on the Spark
  --with-text   Also install Qwen abliterated vLLM

Weights stay on the Spark. This script only rsyncs scripts and workflows.
EOF
}

if [[ -z "$ALIAS" || "$ALIAS" == "-h" || "$ALIAS" == "--help" ]]; then
  usage
  exit 2
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-install) DO_INSTALL=0; shift ;;
    --start) DO_START=1; shift ;;
    --skip-pull) SKIP_PULL=1; shift ;;
    --with-text) WITH_TEXT=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ ! -d "$ROOT/spark-image" || ! -d "$ROOT/spark-install" ]]; then
  echo "Expected spark-image and spark-install under $ROOT" >&2
  exit 1
fi

if ! ssh -o BatchMode=yes -o ConnectTimeout=8 "$ALIAS" 'echo SPARK_SSH_OK' >/dev/null; then
  echo "Cannot SSH to alias '$ALIAS'." >&2
  echo "Pair the Spark in NVIDIA Sync, then: ssh $ALIAS" >&2
  exit 1
fi

echo "Rsync -> ${ALIAS}:${REMOTE_DIR} (no weights)"
ssh -o BatchMode=yes "$ALIAS" "mkdir -p $REMOTE_DIR"
rsync -az --delete \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude 'logs' \
  --exclude '.env' \
  --exclude 'models' \
  "$HERE/" "$ALIAS:$REMOTE_DIR/spark-install/"
rsync -az --delete \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude 'logs' \
  --exclude '.env' \
  "$ROOT/spark-image/" "$ALIAS:$REMOTE_DIR/spark-image/"
if [[ -d "$ROOT/spark" ]]; then
  rsync -az --delete \
    --exclude '.venv' \
    --exclude '__pycache__' \
    --exclude 'models' \
    --exclude '.env' \
    "$ROOT/spark/" "$ALIAS:$REMOTE_DIR/spark/"
fi

if [[ "$DO_INSTALL" -eq 1 ]]; then
  remote_args=()
  [[ "$WITH_TEXT" -eq 1 ]] && remote_args+=(--with-text)
  [[ "$SKIP_PULL" -eq 1 ]] && remote_args+=(--skip-pull)
  [[ "$DO_START" -eq 1 ]] && remote_args+=(--start)
  echo "Running install.sh on $ALIAS"
  ssh -o BatchMode=yes "$ALIAS" "chmod +x $REMOTE_DIR/spark-install/*.sh && $REMOTE_DIR/spark-install/install.sh ${remote_args[*]}"
else
  echo "Copied. On Spark: $REMOTE_DIR/spark-install/install.sh --start"
fi
