#!/usr/bin/env bash
# Install NVIDIA Sync Custom launch scripts onto the Spark (and optionally
# register them with the local nvsync CLI).
#
# On Spark (after push.sh):
#   ~/abliterated-spark/spark-install/nvsync/install-scripts.sh
#
# From the Mac (registers via nvsync script write if nvsync is on PATH):
#   SPARK_SSH_ALIAS=flak3dd bash spark-install/nvsync/install-scripts.sh --mac
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

usage() {
  cat <<'EOF'
Usage: install-scripts.sh [--mac] [ssh-alias]

  (default, on Spark)  Copy port-8188.bash / port-7860.bash / port-8000.bash
                       to ~/.config/NVIDIA/Sync/bin/scripts/
  --mac [alias]        Also nvsync script write <alias> <port> from this Mac
EOF
}

copy_on_spark() {
  local dest="${XDG_CONFIG_HOME:-$HOME/.config}/NVIDIA/Sync/bin/scripts"
  mkdir -p "$dest"
  chmod +x "$HERE"/port-*.bash
  cp -f "$HERE/port-8188.bash" "$dest/port-8188.bash"
  cp -f "$HERE/port-7860.bash" "$dest/port-7860.bash"
  cp -f "$HERE/port-8000.bash" "$dest/port-8000.bash"
  echo "Wrote Sync launch scripts:"
  echo "  $dest/port-8188.bash   Abliterated ComfyUI"
  echo "  $dest/port-7860.bash   Abliterated Images API"
  echo "  $dest/port-8000.bash   Abliterated Qwen (optional)"
}

register_mac() {
  local alias="${1:-}"
  local nvsync=""
  for c in \
    nvsync \
    "/Applications/NVIDIA Sync.app/Contents/Resources/bin/nvsync-arm64" \
    "/Applications/NVIDIA Sync.app/Contents/Resources/bin/nvsync"; do
    if [[ -x "$c" ]] || command -v "$c" >/dev/null 2>&1; then
      nvsync="$c"
      break
    fi
  done
  if [[ -z "$nvsync" ]]; then
    echo "nvsync CLI not found — skip register. Paste scripts in Sync → Settings → Custom." >&2
    return 0
  fi
  if [[ -z "$alias" ]]; then
    echo "Pass the Sync SSH alias: $0 --mac flak3dd" >&2
    return 1
  fi
  echo "nvsync script write $alias 8188 / 7860 / 8000"
  "$nvsync" script write "$alias" 8188 <"$HERE/port-8188.bash"
  "$nvsync" script write "$alias" 7860 <"$HERE/port-7860.bash"
  "$nvsync" script write "$alias" 8000 <"$HERE/port-8000.bash" || true
}

MAC=0
ALIAS=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mac) MAC=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) ALIAS="$1"; shift ;;
  esac
done

if [[ "$MAC" -eq 1 ]]; then
  register_mac "$ALIAS"
else
  copy_on_spark
fi
