const CACHE_MS = 5 * 60_000;

type ModelInfo = { contextLength: number; toolUse: boolean | undefined };
type Cache = {
  at: number;
  planMax: number | undefined;
  models: Map<string, ModelInfo>;
};

let cache: Cache = { at: 0, planMax: undefined, models: new Map() };

export function peekFeatherlessModel(model: string): ModelInfo | undefined {
  const id = (model || '').trim();
  if (!id) return undefined;
  return cache.models.get(id);
}

export function effectiveContextWindow(opts: {
  modelContext?: number;
  planMax?: number;
  settingsContext?: number;
  fallback: number;
}): number {
  const parts = [opts.fallback];
  if (opts.modelContext && opts.modelContext >= 1024) parts.push(Math.floor(opts.modelContext));
  if (opts.planMax && opts.planMax >= 1024) parts.push(Math.floor(opts.planMax));
  if (opts.settingsContext && opts.settingsContext >= 1024) parts.push(Math.floor(opts.settingsContext));
  return Math.max(1024, Math.min(...parts));
}

async function getJson(
  url: string,
  token: string,
  extraHeaders: Record<string, string> | undefined,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(extraHeaders || {}),
  };
  if (token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  const res = await fetch(url, { headers, signal });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

function joinUrl(base: string, suffix: string): string {
  const b = base.replace(/\/$/, '');
  const s = suffix.startsWith('/') ? suffix : `/${suffix}`;
  return b + s;
}

/**
 * Featherless model cards carry context_length (often 8k) while the plan may
 * allow 32k. The prompt must fit the smaller of the two.
 */
export async function resolveFeatherlessContextWindow(opts: {
  modelsUrl: string;
  planUrl: string;
  token: string;
  model: string;
  settingsContext?: number;
  fallback?: number;
  extraHeaders?: Record<string, string>;
  abortSignal?: AbortSignal;
}): Promise<{ contextWindow: number; toolUse?: boolean; planMax?: number; modelContext?: number }> {
  const fallback = opts.fallback ?? 32768;
  const now = Date.now();
  if (now - cache.at > CACHE_MS) {
    cache = { at: now, planMax: cache.planMax, models: cache.models };
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4000);
  const onAbort = () => ac.abort();
  opts.abortSignal?.addEventListener('abort', onAbort, { once: true });
  try {
    if (cache.planMax == null) {
      const plan = (await getJson(opts.planUrl, opts.token, opts.extraHeaders, ac.signal)) as {
        max_context_length?: number;
      } | null;
      const n = Number(plan?.max_context_length);
      if (Number.isFinite(n) && n >= 1024) cache.planMax = Math.floor(n);
    }
    const id = (opts.model || '').trim();
    let info = cache.models.get(id);
    if (!info && id) {
      const url = joinUrl(opts.modelsUrl, id);
      const json = (await getJson(url, opts.token, opts.extraHeaders, ac.signal)) as {
        context_length?: number;
        features?: { tool_use?: boolean };
      } | null;
      const n = Number(json?.context_length);
      info = {
        contextLength: Number.isFinite(n) && n >= 1024 ? Math.floor(n) : fallback,
        toolUse: json?.features?.tool_use,
      };
      cache.models.set(id, info);
      cache.at = Date.now();
    }
    const contextWindow = effectiveContextWindow({
      modelContext: info?.contextLength,
      planMax: cache.planMax,
      settingsContext: opts.settingsContext,
      fallback,
    });
    return {
      contextWindow,
      toolUse: info?.toolUse,
      planMax: cache.planMax,
      modelContext: info?.contextLength,
    };
  } catch {
    return {
      contextWindow: effectiveContextWindow({
        planMax: cache.planMax,
        settingsContext: opts.settingsContext,
        fallback,
      }),
      planMax: cache.planMax,
    };
  } finally {
    clearTimeout(timer);
    opts.abortSignal?.removeEventListener('abort', onAbort);
  }
}
