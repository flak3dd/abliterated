#!/usr/bin/env bash
# Operator control for the Spark OpenAI image bridge on this host.
# Run on the DGX Spark (or any box with spark-image + venv).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
IMG="${ABLITERATED_SPARK_IMAGE:-$HERE}"
LOG="$IMG/logs"
VENV="${COMFY_VENV:-$IMG/.venv}"
PY="$VENV/bin/python"
cmd="${1:-}"

usage() {
  echo "usage: $0 kill|start|post|status" >&2
  echo "  kill    stop serve-openai-bridge.py" >&2
  echo "  start   restart the bridge (SAMPLER_CPU_OFFLOAD=0)" >&2
  echo "  post    smoke POST krea2-raw-fp8 via quality_post.py" >&2
  echo "  status  health + progress + bridge/post pids" >&2
  exit 2
}

mkdir -p "$LOG"

kill_bridge() {
  local pids
  pids="$(ps -eo pid=,args= | awk '/serve-openai-bridge\.py/ && !/awk/ {print $1}')"
  if [[ -n "${pids:-}" ]]; then
    echo "killing $pids"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 0.4
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  else
    echo "no bridge"
  fi
  rm -f "$LOG/bridge.pid"
}

ensure_offload_off() {
  local envf="$IMG/.env"
  [[ -f "$envf" ]] || return 0
  python3 - "$envf" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
lines, seen = [], False
for line in p.read_text().splitlines():
    if line.startswith("SAMPLER_CPU_OFFLOAD="):
        if not seen:
            lines.append("SAMPLER_CPU_OFFLOAD=0")
            seen = True
    else:
        lines.append(line)
if not seen:
    lines.append("SAMPLER_CPU_OFFLOAD=0")
p.write_text("\n".join(lines) + "\n")
print("OFFLOAD", [l for l in p.read_text().splitlines() if "OFFLOAD" in l])
PY
}

start_bridge() {
  if [[ ! -x "$PY" ]]; then
    echo "Missing $PY — install the spark-image venv first." >&2
    exit 1
  fi
  ensure_offload_off
  : >"$LOG/bridge.log"
  (
    cd "$IMG"
    if [[ -f .env ]]; then
      set -a
      # shellcheck disable=SC1091
      source .env
      set +a
    fi
    export SAMPLER_CPU_OFFLOAD=0
    exec "$PY" serve-openai-bridge.py
  ) >>"$LOG/bridge.log" 2>&1 &
  echo $! >"$LOG/bridge.pid"
  echo "PID=$(cat "$LOG/bridge.pid")"
  local i
  for i in $(seq 1 45); do
    if curl -fsS -m 2 http://127.0.0.1:7860/health >/tmp/ablit-image-health.json 2>/dev/null; then
      echo HEALTH_OK
      cat /tmp/ablit-image-health.json
      echo
      return 0
    fi
    sleep 1
  done
  echo HEALTH_FAIL
  tail -n 40 "$LOG/bridge.log"
  return 1
}

start_post() {
  nohup python3 "$HERE/quality_post.py" \
    --out "$LOG/quality-test-krea.png" \
    --status-file "$LOG/quality_post.status" \
    >"$LOG/quality-post.out" 2>&1 &
  echo $! >"$LOG/quality_post.pid"
  echo "POST=$(cat "$LOG/quality_post.pid")"
}

case "$cmd" in
  kill) kill_bridge ;;
  start) kill_bridge; sleep 1; start_bridge ;;
  post) start_post ;;
  status)
    curl -sS -m 3 http://127.0.0.1:7860/health || echo NO_HEALTH
    echo
    curl -sS -m 3 http://127.0.0.1:7860/v1/progress || true
    echo
    cat "$LOG/quality_post.status" 2>/dev/null || true
    ps -eo pid=,etime=,pcpu=,args= | awk '/serve-openai-bridge\.py|quality_post\.py/ && !/awk/ {print}'
    ;;
  *) usage ;;
esac
