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
  'gpt-oss': {
    id: 'gpt-oss',
    label: 'GPT-OSS 120B MXFP4 abliterated',
    servedName: 'gpt-oss-120b-abliterated',
    compose: 'docker-compose.gpt-oss-120b-abliterated.yml',
    container: 'gpt-oss-120b-abliterated',
    pull: 'pull-gpt-oss-120b.sh',
    modelDir: 'models/Huihui-gpt-oss-120b-mxfp4-abliterated',
    gpuMemoryUtilization: 0.7,
    maxModelLen: 131072,
    kvCacheDtype: 'fp8',
    quantization: 'mxfp4',
    reasoningParser: 'openai_gptoss',
    toolCallParser: 'openai',
    hf: 'batsclamp/Huihui-gpt-oss-120b-mxfp4-abliterated',
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
  const recipe = raw?.recipe === 'gpt-oss' ? 'gpt-oss' : 'qwen';
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

  const [health, modelsApi, version] = await Promise.all([
    httpGetJson(`http://127.0.0.1:${port}/health`),
    httpGetJson(`http://127.0.0.1:${port}/v1/models`),
    httpGetJson(`http://127.0.0.1:${port}/version`),
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
  const recipe = opts.recipe === 'gpt-oss' ? 'gpt-oss' : 'qwen';
  const remoteDir = await resolveRemoteDir(alias);
  const script = RECIPES[recipe].pull;
  const local = path.join(SPARK_LOCAL, script);
  await scp(alias, local, `${remoteDir}/${script}`);
  const pidFile = recipe === 'gpt-oss' ? 'pull-gpt-oss-120b.pid' : 'pull-model.pid';
  const logFile = recipe === 'gpt-oss' ? 'pull-gpt-oss-120b.log' : 'pull-model.log';
  const { stdout } = await ssh(
    alias,
    `chmod +x ${remoteDir}/${script}; cd ${remoteDir}; if [[ -f ${pidFile} ]] && kill -0 "$(cat ${pidFile})" 2>/dev/null; then echo ALREADY; else nohup ./${script} >> ${logFile} 2>&1 & echo $! > ${pidFile}; echo STARTED; fi`,
  );
  return { ok: true, recipe, state: stdout.trim(), remoteDir };
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
    default:
      throw new Error(`Unknown vLLM control op: ${op}`);
  }
}
