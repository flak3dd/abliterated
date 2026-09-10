/**
 * Spark vLLM control: SSH to the NVIDIA Sync alias and probe the local :8000 tunnel.
 * Bindings stay 127.0.0.1. Alias/recipe/flags are allowlisted.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const execFileP = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPARK_LOCAL = path.resolve(HERE, '..', 'spark');

export const RECIPES = {
  qwen: {
    id: 'qwen',
    label: 'Qwen 3.6 35B-A3B NVFP4+MTP',
    servedName: 'qwen-abliterated',
    compose: 'docker-compose.qwen-abliterated.yml',
    container: 'qwen-abliterated',
    pull: 'pull-model.sh',
    modelDir: 'models/Qwen3.6-35B-A3B-abliterated-NVFP4-MTP',
    gpuMemoryUtilization: 0.6,
    maxModelLen: 65536,
    kvCacheDtype: 'fp8',
    quantization: 'nvfp4',
    reasoningParser: 'qwen3',
    toolCallParser: 'qwen3_coder',
    hf: 'THe-Plague/Qwen3.6-35B-A3B-abliterated-NVFP4-MTP',
  },
};

export function defaultConfig(recipeId = 'qwen') {
  const r = RECIPES[recipeId] || RECIPES.qwen;
  return {
    recipe: r.id,
    servedName: r.servedName,
    port: 8000,
    gpuMemoryUtilization: r.gpuMemoryUtilization,
    maxModelLen: r.maxModelLen,
    kvCacheDtype: r.kvCacheDtype,
    quantization: r.quantization,
    reasoningParser: r.reasoningParser,
    toolCallParser: r.toolCallParser,
  };
}

function assertAlias(alias) {
  const a = String(alias || '').trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(a)) throw new Error('Invalid SSH alias');
  return a;
}

function sanitizeConfig(raw) {
  const recipe = RECIPES[raw?.recipe] ? raw.recipe : 'qwen';
  const base = defaultConfig(recipe);
  const servedName = String(raw?.servedName || base.servedName).trim();
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(servedName)) throw new Error('Invalid served model name');
  const gpu = Number(raw?.gpuMemoryUtilization ?? base.gpuMemoryUtilization);
  if (!Number.isFinite(gpu) || gpu < 0.2 || gpu > 0.95) throw new Error('gpuMemoryUtilization must be 0.20–0.95');
  const maxModelLen = Math.floor(Number(raw?.maxModelLen ?? base.maxModelLen));
  if (!Number.isFinite(maxModelLen) || maxModelLen < 2048 || maxModelLen > 262144) {
    throw new Error('maxModelLen must be 2048–262144');
  }
  const kv = String(raw?.kvCacheDtype || base.kvCacheDtype);
  if (!['fp8', 'auto', 'fp16'].includes(kv)) throw new Error('kvCacheDtype must be fp8, auto, or fp16');
  const port = Math.floor(Number(raw?.port ?? 8000));
  if (!Number.isFinite(port) || port < 1024 || port > 65535) throw new Error('port must be 1024–65535');
  return {
    ...base,
    recipe,
    servedName,
    gpuMemoryUtilization: Math.round(gpu * 100) / 100,
    maxModelLen,
    kvCacheDtype: kv,
    port,
  };
}

async function ssh(alias, remote, timeout = 20000) {
  const { stdout, stderr } = await execFileP(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', alias, remote],
    { timeout, maxBuffer: 2_000_000 },
  );
  return { stdout: String(stdout || ''), stderr: String(stderr || '') };
}

async function scp(alias, localPath, remotePath) {
  await execFileP('scp', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', localPath, `${alias}:${remotePath}`], {
    timeout: 30000,
  });
}

function httpGetJson(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = body ? JSON.parse(body) : null;
        } catch {
          json = { raw: body.slice(0, 400) };
        }
        resolve({ ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300, status: res.statusCode || 0, json, body });
      });
    });
    req.on('error', (err) => resolve({ ok: false, status: 0, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0, error: 'timeout' });
    });
  });
}

async function resolveRemoteDir(alias) {
  const { stdout } = await ssh(
    alias,
    'if [ -d "$HOME/spark" ]; then echo $HOME/spark; elif [ -d "$HOME/abliterated-spark/spark" ]; then echo $HOME/abliterated-spark/spark; fi',
  );
  const dir = stdout.trim().split('\n').pop() || '';
  if (!dir) throw new Error('No spark/ directory on the remote host');
  return dir;
}

async function readSavedConfig(alias, remoteDir) {
  try {
    const { stdout } = await ssh(alias, `cat ${remoteDir}/vllm-ui.json 2>/dev/null || true`);
    if (!stdout.trim()) return null;
    return sanitizeConfig(JSON.parse(stdout));
  } catch {
    return null;
  }
}

export function parseGpuCsvLine(line) {
  if (!line || typeof line !== 'string') return null;
  const parts = line.trim().split(',').map((s) => s.trim());
  if (parts.length < 7) return null;
  return {
    name: parts[0] || 'NVIDIA GPU',
    driver: parts[1] || '—',
    tempC: Number(parts[2]) || 0,
    gpuUtilPct: Number(parts[3]) || 0,
    memUtilPct: Number(parts[4]) || 0,
    vramUsedMb: Number(parts[5]) || 0,
    vramTotalMb: Number(parts[6]) || 0,
    powerDrawW: Number(parts[7]) || 0,
    powerLimitW: Number(parts[8]) || 0,
  };
}

export async function queryGpuStatus(alias) {
  try {
    const { stdout } = await ssh(
      alias,
      'nvidia-smi --query-gpu=name,driver_version,temperature.gpu,utilization.gpu,utilization.memory,memory.used,memory.total,power.draw,power.limit --format=csv,noheader,nounits 2>/dev/null || true',
      10000,
    );
    const line = (stdout || '').trim().split('\n')[0];
    return parseGpuCsvLine(line);
  } catch {
    return null;
  }
}

export async function queryImageStatus(alias, host = '127.0.0.1', port = 7860) {
  const [health, modelsApi] = await Promise.all([
    httpGetJson(`http://${host}:${port}/health`, 2000),
    httpGetJson(`http://${host}:${port}/v1/models`, 2000),
  ]);

  let pid = null;
  let running = false;
  let smokeStatus = null;

  try {
    const { stdout } = await ssh(
      alias,
      `p=$(ps -eo pid=,args= | awk '/serve-openai-bridge\\.py/ && !/awk/ {print $1}'); echo "$p"; cat ~/abliterated-spark/spark-image/logs/quality_post.status 2>/dev/null || cat ~/spark-image/logs/quality_post.status 2>/dev/null || true`,
      8000,
    );
    const lines = (stdout || '').trim().split('\n');
    const firstPid = parseInt(lines[0], 10);
    if (!Number.isNaN(firstPid) && firstPid > 0) {
      pid = firstPid;
      running = true;
    }
    if (lines[1]) {
      smokeStatus = lines.slice(1).join(' ').trim();
    }
  } catch {
    // SSH not available or failed
  }

  const liveModels = Array.isArray(modelsApi.json?.data)
    ? modelsApi.json.data.map((m) => (typeof m === 'string' ? m : (m && m.id) || ''))
    : [];

  return {
    port,
    running: running || health.ok,
    pid,
    health: health.ok,
    healthError: health.error || (!health.ok && health.status ? `HTTP ${health.status}` : ''),
    smokeStatus,
    models: liveModels.filter(Boolean),
  };
}

export async function vllmStatus(opts = {}) {
  const alias = assertAlias(opts.alias || 'flak3dd');
  const port = Math.floor(Number(opts.port || 8000));
  let remoteDir = '';
  let sshOk = false;
  let sshError = '';
  let docker = [];
  let models = [];
  let pull = { running: false, log: '', bytes: 0 };
  let saved = null;
  try {
    remoteDir = await resolveRemoteDir(alias);
    sshOk = true;
    saved = await readSavedConfig(alias, remoteDir);
    const { stdout: ps } = await ssh(
      alias,
      'docker ps -a --filter name=qwen-abliterated --filter name=gpt-oss-120b-abliterated --format "{{.Names}}|{{.Status}}|{{.Ports}}"',
    );
    docker = ps
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, status, ports] = line.split('|');
        return { name, status, ports, running: /\bUp\b/i.test(status || '') };
      });
    const { stdout: du } = await ssh(
      alias,
      `python3 - <<'PY'
import os, json
root="${remoteDir}/models"
out=[]
if os.path.isdir(root):
  for name in sorted(os.listdir(root)):
    p=os.path.join(root,name)
    if not os.path.isdir(p):
      continue
    size=0
    shards=0
    cfg=os.path.isfile(os.path.join(p,"config.json"))
    for dirpath, _, files in os.walk(p):
      for f in files:
        fp=os.path.join(dirpath,f)
        try: size += os.path.getsize(fp)
        except OSError: pass
        if f.startswith("model-") and f.endswith(".safetensors"):
          shards += 1
    out.append({"name":name,"bytes":size,"shards":shards,"config":cfg})
print(json.dumps(out))
PY`,
      25000,
    );
    try {
      models = JSON.parse(du.trim() || '[]');
    } catch {
      models = [];
    }
    const { stdout: pullPs } = await ssh(
      alias,
      `p=$(cat ${remoteDir}/pull-gpt-oss-120b.pid ${remoteDir}/pull-gpt-oss.pid 2>/dev/null | head -1); if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then echo running; else echo idle; fi; du -sb ${remoteDir}/models/Huihui-gpt-oss-120b-mxfp4-abliterated 2>/dev/null | awk '{print $1}'; tail -c 240 ${remoteDir}/pull-gpt-oss-120b.log 2>/dev/null | tr -d '\\r'`,
    );
    const plines = pullPs.split('\n');
    pull = {
      running: (plines[0] || '').trim() === 'running',
      bytes: Number(plines[1] || 0) || 0,
      log: plines.slice(2).join(' ').trim().slice(-240),
    };
  } catch (err) {
    sshError = err instanceof Error ? err.message : String(err);
  }

  const candidateHosts = ['127.0.0.1', '192.168.4.101', 'gx10-d0e7.local'];
  let liveHost = '127.0.0.1';
  let health = { ok: false, status: 0 };
  let modelsApi = { ok: false, status: 0 };
  let version = { ok: false, status: 0 };

  for (const h of candidateHosts) {
    const [hRes, mRes, vRes] = await Promise.all([
      httpGetJson(`http://${h}:${port}/health`, 1500),
      httpGetJson(`http://${h}:${port}/v1/models`, 1500),
      httpGetJson(`http://${h}:${port}/version`, 1500),
    ]);
    if (hRes.ok || mRes.ok) {
      liveHost = h;
      health = hRes;
      modelsApi = mRes;
      version = vRes;
      break;
    }
  }

  const [gpu, image] = await Promise.all([
    sshOk ? queryGpuStatus(alias) : Promise.resolve(null),
    queryImageStatus(alias, liveHost, 7860),
  ]);

  const liveModels = Array.isArray(modelsApi.json?.data)
    ? modelsApi.json.data.map((m) => ({ id: m.id, max_model_len: m.max_model_len, root: m.root }))
    : [];

  return {
    ok: true,
    alias,
    remoteDir,
    sshOk,
    sshError,
    docker,
    models,
    pull,
    gpu,
    image,
    saved: saved || defaultConfig('qwen'),
    recipes: Object.values(RECIPES),
    live: {
      port,
      health: health.ok,
      healthError: health.error || (!health.ok ? `HTTP ${health.status}` : ''),
      version: version.json?.version || null,
      models: liveModels,
    },
  };
}

export async function vllmSave(opts = {}) {
  const alias = assertAlias(opts.alias || 'flak3dd');
  const cfg = sanitizeConfig(opts.config || opts);
  const remoteDir = await resolveRemoteDir(alias);
  const tmp = path.join(os.tmpdir(), `vllm-ui-${process.pid}.json`);
  await fs.writeFile(tmp, JSON.stringify(cfg, null, 2));
  await scp(alias, tmp, `${remoteDir}/vllm-ui.json`);
  await fs.unlink(tmp).catch(() => {});
  return { ok: true, saved: cfg, remoteDir };
}

export async function vllmServe(opts = {}) {
  const alias = assertAlias(opts.alias || 'flak3dd');
  const cfg = sanitizeConfig(opts.config || opts);
  const remoteDir = await resolveRemoteDir(alias);
  const tmp = path.join(os.tmpdir(), `vllm-ui-${process.pid}.json`);
  await fs.writeFile(tmp, JSON.stringify(cfg, null, 2));
  await scp(alias, tmp, `${remoteDir}/vllm-ui.json`);
  await fs.unlink(tmp).catch(() => {});
  const applyLocal = path.join(SPARK_LOCAL, 'apply-vllm-ui.sh');
  await scp(alias, applyLocal, `${remoteDir}/apply-vllm-ui.sh`);
  const composeLocal = path.join(SPARK_LOCAL, RECIPES[cfg.recipe].compose);
  await scp(alias, composeLocal, `${remoteDir}/${RECIPES[cfg.recipe].compose}`);
  const { stdout, stderr } = await ssh(
    alias,
    `chmod +x ${remoteDir}/apply-vllm-ui.sh && ${remoteDir}/apply-vllm-ui.sh`,
    180000,
  );
  return { ok: true, saved: cfg, remoteDir, stdout: stdout.slice(-4000), stderr: stderr.slice(-2000) };
}

export async function vllmStop(opts = {}) {
  const alias = assertAlias(opts.alias || 'flak3dd');
  const { stdout, stderr } = await ssh(
    alias,
    'docker rm -f qwen-abliterated gpt-oss-120b-abliterated 2>/dev/null || true; echo stopped',
  );
  return { ok: true, stdout: stdout.trim(), stderr };
}

export async function vllmPull(opts = {}) {
  const alias = assertAlias(opts.alias || 'flak3dd');
  const recipe = RECIPES[opts.recipe] ? opts.recipe : 'qwen';
  const remoteDir = await resolveRemoteDir(alias);
  const script = RECIPES[recipe].pull;
  const local = path.join(SPARK_LOCAL, script);
  await scp(alias, local, `${remoteDir}/${script}`);
  const pidFile = 'pull-model.pid';
  const logFile = 'pull-model.log';
  const { stdout } = await ssh(
    alias,
    `chmod +x ${remoteDir}/${script}; cd ${remoteDir}; if [[ -f ${pidFile} ]] && kill -0 "$(cat ${pidFile})" 2>/dev/null; then echo ALREADY; else nohup ./${script} >> ${logFile} 2>&1 & echo $! > ${pidFile}; echo STARTED; fi`,
  );
  return { ok: true, recipe, state: stdout.trim(), remoteDir };
}

export async function sparkImageCtl(alias, action) {
  assertAlias(alias);
  const act = String(action || 'status').toLowerCase();
  const cmd = `if [ -f "$HOME/abliterated-spark/spark-image/spark_ctl.sh" ]; then bash "$HOME/abliterated-spark/spark-image/spark_ctl.sh" ${act}; elif [ -f "$HOME/spark-image/spark_ctl.sh" ]; then bash "$HOME/spark-image/spark_ctl.sh" ${act}; else echo "spark_ctl.sh not found"; exit 1; fi`;
  const { stdout, stderr } = await ssh(alias, cmd, 60000);
  return { ok: true, action: act, stdout: (stdout || '').slice(-4000), stderr: (stderr || '').slice(-2000) };
}

export async function sparkStackCtl(alias, action) {
  assertAlias(alias);
  const act = String(action || 'status').toLowerCase();
  let cmd = '';
  if (act === 'start-all' || act === 'start') {
    cmd = `if [ -f "$HOME/abliterated-spark/spark-install/start.sh" ]; then bash "$HOME/abliterated-spark/spark-install/start.sh" --with-text; elif [ -f "$HOME/spark-install/start.sh" ]; then bash "$HOME/spark-install/start.sh" --with-text; else echo "start.sh not found"; exit 1; fi`;
  } else if (act === 'stop-all' || act === 'stop') {
    cmd = `if [ -f "$HOME/abliterated-spark/spark-install/stop.sh" ]; then bash "$HOME/abliterated-spark/spark-install/stop.sh"; elif [ -f "$HOME/spark-install/stop.sh" ]; then bash "$HOME/spark-install/stop.sh"; else echo "stop.sh not found"; exit 1; fi`;
  } else if (act === 'free-ports') {
    cmd = `fuser -k 8000/tcp 7860/tcp 2>/dev/null || true; pkill -f "serve-openai-bridge.py" 2>/dev/null || true; docker rm -f qwen-abliterated gpt-oss-120b-abliterated 2>/dev/null || true; echo "Ports 8000 & 7860 freed"`;
  } else if (act === 'probe' || act === 'status') {
    cmd = `if [ -f "$HOME/abliterated-spark/spark-install/status.sh" ]; then bash "$HOME/abliterated-spark/spark-install/status.sh" 127.0.0.1; elif [ -f "$HOME/spark-install/status.sh" ]; then bash "$HOME/spark-install/status.sh" 127.0.0.1; else echo "status.sh not found"; exit 1; fi`;
  } else {
    throw new Error(`Unknown stack action: ${act}`);
  }
  const { stdout, stderr } = await ssh(alias, cmd, 90000);
  return { ok: true, action: act, stdout: (stdout || '').slice(-4000), stderr: (stderr || '').slice(-2000) };
}

export async function sparkLogs(alias, target, lines = 120) {
  assertAlias(alias);
  const n = Math.min(500, Math.max(10, Number(lines) || 120));
  let cmd = '';
  if (target === 'image') {
    cmd = `tail -n ${n} "$HOME/abliterated-spark/spark-image/logs/bridge.log" 2>/dev/null || tail -n ${n} "$HOME/spark-image/logs/bridge.log" 2>/dev/null || echo "No image bridge log"`;
  } else if (target === 'post' || target === 'smoketest') {
    cmd = `tail -n ${n} "$HOME/abliterated-spark/spark-image/logs/quality-post.out" 2>/dev/null || tail -n ${n} "$HOME/spark-image/logs/quality-post.out" 2>/dev/null || echo "No smoke test log"`;
  } else if (target === 'pull') {
    cmd = `tail -n ${n} "$HOME/spark/pull-*.log" 2>/dev/null || tail -n ${n} "$HOME/abliterated-spark/spark/pull-*.log" 2>/dev/null || echo "No pull log"`;
  } else {
    cmd = `docker logs --tail ${n} qwen-abliterated 2>&1 || docker logs --tail ${n} gpt-oss-120b-abliterated 2>&1 || echo "No vLLM container running"`;
  }
  const { stdout, stderr } = await ssh(alias, cmd, 15000);
  return { ok: true, target, logs: (stdout || stderr || '').slice(-16000) };
}

export async function handleVllmCtl(op, payload = {}) {
  switch (op) {
    case 'status':
      return vllmStatus(payload);
    case 'save':
      return vllmSave(payload);
    case 'serve':
      return vllmServe(payload);
    case 'stop':
      return vllmStop(payload);
    case 'pull':
      return vllmPull(payload);
    case 'recipes':
      return { ok: true, recipes: Object.values(RECIPES), defaults: defaultConfig('qwen') };
    case 'gpu':
      return { ok: true, gpu: await queryGpuStatus(assertAlias(payload.alias || 'flak3dd')) };
    case 'image-status':
      return { ok: true, image: await queryImageStatus(assertAlias(payload.alias || 'flak3dd'), payload.host || '127.0.0.1', payload.port || 7860) };
    case 'image-action':
      return sparkImageCtl(assertAlias(payload.alias || 'flak3dd'), payload.action || payload.op);
    case 'stack-action':
      return sparkStackCtl(assertAlias(payload.alias || 'flak3dd'), payload.action || payload.op);
    case 'logs':
      return sparkLogs(assertAlias(payload.alias || 'flak3dd'), payload.target || 'vllm', payload.lines || 120);
    default:
      throw new Error(`Unknown vLLM / Spark control op: ${op}`);
  }
}
