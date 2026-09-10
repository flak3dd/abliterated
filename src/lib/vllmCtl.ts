export type VllmRecipeId = 'qwen';

export type VllmConfig = {
  recipe: VllmRecipeId;
  servedName: string;
  port: number;
  gpuMemoryUtilization: number;
  maxModelLen: number;
  kvCacheDtype: 'fp8' | 'auto' | 'fp16';
  quantization: string;
  reasoningParser: string;
  toolCallParser: string;
};

export type VllmRecipe = {
  id: VllmRecipeId;
  label: string;
  servedName: string;
  compose: string;
  container: string;
  pull: string;
  modelDir: string;
  gpuMemoryUtilization: number;
  maxModelLen: number;
  kvCacheDtype: string;
  quantization: string;
  reasoningParser: string;
  toolCallParser: string;
  hf: string;
};

export type SparkGpuMetrics = {
  name: string;
  driver: string;
  tempC: number;
  gpuUtilPct: number;
  memUtilPct: number;
  vramUsedMb: number;
  vramTotalMb: number;
  powerDrawW: number;
  powerLimitW: number;
};

export type SparkImageBridgeStatus = {
  port: number;
  running: boolean;
  pid?: number | null;
  health: boolean;
  healthError?: string;
  smokeStatus?: string | null;
  models: string[];
};

export type VllmStatus = {
  ok: boolean;
  error?: string;
  alias: string;
  remoteDir: string;
  sshOk: boolean;
  sshError: string;
  docker: { name: string; status: string; ports: string; running: boolean }[];
  models: { name: string; bytes: number; shards: number; config: boolean }[];
  pull: { running: boolean; bytes: number; log: string };
  gpu?: SparkGpuMetrics | null;
  image?: SparkImageBridgeStatus | null;
  saved: VllmConfig;
  recipes: VllmRecipe[];
  live: {
    port: number;
    health: boolean;
    healthError: string;
    version: string | null;
    models: { id: string; max_model_len?: number; root?: string }[];
  };
};

export const VLLM_RECIPE_PRESETS: Pick<VllmRecipe, 'id' | 'label' | 'servedName' | 'hf' | 'gpuMemoryUtilization' | 'maxModelLen' | 'kvCacheDtype' | 'quantization' | 'reasoningParser' | 'toolCallParser'>[] = [
  {
    id: 'qwen',
    label: 'Qwen 3.6 35B-A3B NVFP4+MTP',
    servedName: 'qwen-abliterated',
    hf: 'THe-Plague/Qwen3.6-35B-A3B-abliterated-NVFP4-MTP',
    gpuMemoryUtilization: 0.6,
    maxModelLen: 65536,
    kvCacheDtype: 'fp8',
    quantization: 'nvfp4',
    reasoningParser: 'qwen3',
    toolCallParser: 'qwen3_coder',
  },
];

async function viaFetch<T = VllmStatus & Record<string, unknown>>(op: string, payload: Record<string, unknown>): Promise<T> {
  const r = await fetch('/vllm-ctl/' + op, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = (await r.json()) as T & { ok?: boolean; error?: string };
  if (!r.ok || json.ok === false) throw new Error(json.error || `vLLM control HTTP ${r.status}`);
  return json as T;
}

export async function vllmCtl(op: string, payload: Record<string, unknown> = {}): Promise<VllmStatus & Record<string, unknown>> {
  return viaFetch(op, payload);
}

export async function sparkImageAction(alias: string, action: string): Promise<{ ok: boolean; action: string; stdout?: string; stderr?: string }> {
  return viaFetch<{ ok: boolean; action: string; stdout?: string; stderr?: string }>('image-action', { alias, action });
}

export async function sparkStackAction(alias: string, action: string): Promise<{ ok: boolean; action: string; stdout?: string; stderr?: string }> {
  return viaFetch<{ ok: boolean; action: string; stdout?: string; stderr?: string }>('stack-action', { alias, action });
}

export async function sparkTailLogs(alias: string, target: 'vllm' | 'image' | 'smoketest' | 'pull', lines = 120): Promise<{ ok: boolean; target: string; logs: string }> {
  return viaFetch<{ ok: boolean; target: string; logs: string }>('logs', { alias, target, lines });
}

export function formatBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`;
}
