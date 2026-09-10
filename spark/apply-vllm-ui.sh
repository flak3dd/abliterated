#!/usr/bin/env bash
# Apply vllm-ui.json on the Spark host. One text vLLM on :PORT at a time.
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f vllm-ui.json ]]; then
  echo "missing vllm-ui.json" >&2
  exit 2
fi

python3 - <<'PY'
import json, re, sys
c = json.load(open("vllm-ui.json"))
recipe = str(c.get("recipe") or "qwen")
if recipe not in ("qwen", "gpt-oss"):
    sys.exit("bad recipe")
name = str(c.get("servedName") or "")
if not re.fullmatch(r"[A-Za-z0-9._:-]{1,80}", name):
    sys.exit("bad servedName")
gpu = float(c.get("gpuMemoryUtilization") or 0.6)
if not 0.2 <= gpu <= 0.95:
    sys.exit("bad gpuMemoryUtilization")
maxlen = int(c.get("maxModelLen") or 65536)
if not 2048 <= maxlen <= 262144:
    sys.exit("bad maxModelLen")
kv = str(c.get("kvCacheDtype") or "fp8")
if kv not in ("fp8", "auto", "fp16"):
    sys.exit("bad kvCacheDtype")
port = int(c.get("port") or 8000)
if not 1024 <= port <= 65535:
    sys.exit("bad port")
open(".env.vllm-ui", "w").write(
    f"RECIPE={recipe}\n"
    f"SERVED_NAME={name}\n"
    f"GPU_MEMORY_UTILIZATION={gpu}\n"
    f"MAX_MODEL_LEN={maxlen}\n"
    f"KV_CACHE_DTYPE={kv}\n"
    f"PORT={port}\n"
)
print(recipe)
PY

set -a
# shellcheck disable=SC1091
source .env.vllm-ui
set +a

if [[ "$RECIPE" == "gpt-oss" ]]; then
  COMPOSE=docker-compose.gpt-oss-120b-abliterated.yml
  KEEP=gpt-oss-120b-abliterated
else
  COMPOSE=docker-compose.qwen-abliterated.yml
  KEEP=qwen-abliterated
fi

docker rm -f qwen-abliterated gpt-oss-120b-abliterated >/dev/null 2>&1 || true
echo "compose $COMPOSE served=$SERVED_NAME gpu=$GPU_MEMORY_UTILIZATION max_len=$MAX_MODEL_LEN kv=$KV_CACHE_DTYPE port=$PORT"
exec docker compose --env-file .env.vllm-ui -f "$COMPOSE" up -d --force-recreate --remove-orphans
