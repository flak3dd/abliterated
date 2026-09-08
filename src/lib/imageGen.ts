import type { ClientSettings } from '../types';
import { endpointUrl } from './apiUrl';
import { resolveSparkImageModel } from './sparkInstall';

export type ImageGenArgs = {
  settings: ClientSettings;
  prompt: string;
  size?: string;
  n?: number;
  model?: string;
  /** Build D / bridge sampler overrides (optional). */
  steps?: number;
  guidance?: number;
  loraStrength?: number;
  negative?: string;
  intent?: string;
  /** Optional reference image (base64, no data: prefix) for Edit / img2img paths. */
  imageB64?: string;
  abortSignal?: AbortSignal;
  /** Optional progress callback. `estimated` is true when value is client-side only. */
  onProgress?: (percent: number, estimated: boolean) => void;
};

export type ImageGenResult = {
  b64?: string;
  url?: string;
  revisedPrompt?: string;
  /** Present when the API returned multiple images (n>1). First entry matches top-level fields. */
  images?: Array<{ b64?: string; url?: string; revisedPrompt?: string }>;
};

function imageEndpointUrl(settings: ClientSettings, suffix: string): string {
  const base = (settings.imageBaseUrl || 'http://127.0.0.1:7860/v1').replace(/\/$/, '');
  const pathSuffix = suffix.startsWith('/') ? suffix : '/' + suffix;
  const joined = base + pathSuffix;

  if (import.meta.env.DEV && settings.imageViaProxy !== false) {
    try {
      const url = new URL(joined);
      const port = url.port || (url.protocol === 'https:' ? '443' : '80');
      const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
      const local = loopback && (port === '7860' || settings.imageViaProxy === true);
      // Never rewrite a LAN Spark URL through the Vite :7860 proxy.
      if (local) {
        let path = url.pathname;
        if (path.startsWith('/v1')) path = '/image-v1' + path.slice(3);
        else if (path === '/' || path === '') path = '/image-v1';
        else path = '/image-v1' + (path.startsWith('/') ? path : '/' + path);
        return path + url.search;
      }
    } catch {
      /* keep joined */
    }
  }
  void endpointUrl;
  return joined;
}

const BRIDGE_OFFLINE_FRIENDLY =
  'Spark image bridge offline. Use the status card on the Images tab (Start tunnel / Use LAN / Open Endpoint / Copy start command).';

export function isBridgeOfflineError(msg: string): boolean {
  return /bridge offline|Image server unreachable|Image fetch failed|ECONNREFUSED|ENOTFOUND|socket hang up|HTTP 502|HTTP 503|HTTP 504|Failed to fetch|NetworkError|Load failed/i.test(
    msg || '',
  );
}

/** Soften generate/test errors for toasts; keep raw detail for expanded Endpoint. */
export function friendlyImageError(err: unknown): { friendly: string; detail: string } {
  const detail = err instanceof Error ? err.message : String(err);
  if (isBridgeOfflineError(detail)) {
    return { friendly: BRIDGE_OFFLINE_FRIENDLY, detail };
  }
  const first = detail.split('\n').map((l) => l.trim()).find(Boolean) || detail;
  return { friendly: first, detail };
}

function friendlyHttpError(status: number, body: string, requestUrl: string): string {
  const clipped = (body || '').trim().slice(0, 400);
  const looksEmpty = !clipped;
  const looksProxyFail =
    status === 500 || status === 502 || status === 503 || status === 504;
  if (looksProxyFail && (looksEmpty || /ECONNREFUSED|ENOTFOUND|socket hang up|connect/i.test(clipped))) {
    // Friendly primary; technical request line kept for Endpoint "Show error details".
    return `${BRIDGE_OFFLINE_FRIENDLY}\n(HTTP ${status})\nRequest: ${requestUrl}${clipped ? `\n${clipped}` : ''}`;
  }
  if (status === 404) {
    return [
      'Image endpoint not found (wrong URL or host). Cloud chat has vision input only — no hosted image generation.',
      `Request: ${requestUrl}`,
      clipped,
    ]
      .filter(Boolean)
      .join('\n');
  }
  return `HTTP ${status}: ${clipped || '(empty body)'}`;
}

async function pollServerProgress(
  settings: ClientSettings,
  onProgress: (percent: number, estimated: boolean) => void,
  abortSignal?: AbortSignal,
): Promise<() => void> {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const progUrl = imageEndpointUrl(settings, '/progress');
      const headers: Record<string, string> = {};
      const token = (settings.imageToken || '').trim();
      if (token) headers.Authorization = 'Bearer ' + token;
      const res = await fetch(progUrl, { headers, signal: abortSignal });
      if (!res.ok) return;
      const json = (await res.json()) as { progress?: number; percent?: number };
      const raw = typeof json.progress === 'number' ? json.progress : json.percent;
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        onProgress(Math.min(99, Math.max(0, Math.round(raw))), false);
      }
    } catch {
      /* optional endpoint */
    }
  };
  void tick();
  const id = window.setInterval(() => void tick(), 400);
  return () => {
    stopped = true;
    window.clearInterval(id);
  };
}

export async function generateImage(args: ImageGenArgs): Promise<ImageGenResult> {
  const {
    settings,
    prompt,
    size = '1024x1024',
    n = 1,
    model,
    steps,
    guidance,
    loraStrength,
    negative,
    intent,
    imageB64,
    abortSignal,
    onProgress,
  } = args;
  if (!settings.imageGenEnabled) {
    throw new Error('Image generation is disabled. Enable it in Settings / Images (see spark-image/).');
  }
  const url = imageEndpointUrl(settings, '/images/generations');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = (settings.imageToken || '').trim();
  if (token) headers.Authorization = 'Bearer ' + token;

  // Match spark-image/serve-openai-bridge.py ImageRequest: OpenAI fields + optional
  // top-level sampler/intent + nested `extra` (bridge prefers request overrides when set).
  const body: Record<string, unknown> = {
    model: resolveSparkImageModel(model || settings.imageModel),
    prompt,
    size,
    n: Math.min(4, Math.max(1, Math.floor(n) || 1)),
    response_format: 'b64_json',
  };
  const extra: Record<string, unknown> = {};
  if (typeof steps === 'number' && Number.isFinite(steps)) {
    body.steps = steps;
    extra.steps = steps;
  }
  if (typeof guidance === 'number' && Number.isFinite(guidance)) {
    body.guidance = guidance;
    body.guidance_scale = guidance;
    extra.guidance = guidance;
    extra.guidance_scale = guidance;
  }
  if (typeof loraStrength === 'number' && Number.isFinite(loraStrength)) {
    body.lora_strength = loraStrength;
    extra.lora_strength = loraStrength;
  }
  if (typeof negative === 'string' && negative.trim()) {
    body.negative = negative.trim();
    extra.negative = negative.trim();
  }
  if (typeof intent === 'string' && intent.trim()) {
    body.intent = intent.trim();
    extra.intent = intent.trim();
  }
  const refB64 = typeof imageB64 === 'string' ? imageB64.trim() : '';
  if (refB64) {
    // OpenAI-ish + bridge aliases (serve-openai-bridge ImageRequest).
    body.image = refB64;
    body.image_b64 = refB64;
    extra.image = refB64;
    extra.image_b64 = refB64;
  }
  if (Object.keys(extra).length > 0) body.extra = extra;

  let stopPoll: (() => void) | undefined;
  if (onProgress) {
    onProgress(1, true);
    stopPoll = await pollServerProgress(settings, onProgress, abortSignal);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: abortSignal,
    });
  } catch (err) {
    stopPoll?.();
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    if (err instanceof Error && err.name === 'AbortError') throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      [
        BRIDGE_OFFLINE_FRIENDLY,
        `Image fetch failed: ${msg}`,
        `Request: ${url}`,
      ].join('\n'),
    );
  }
  const text = await res.text();
  stopPoll?.();
  if (!res.ok) {
    throw new Error(friendlyHttpError(res.status, text, url));
  }
  let json: {
    data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new Error('Invalid JSON from image endpoint');
  }
  const mapped = (json.data || [])
    .map((d) => ({
      b64: d.b64_json || undefined,
      url: d.url || undefined,
      revisedPrompt: d.revised_prompt || undefined,
    }))
    .filter((d) => d.b64 || d.url);
  const first = mapped[0];
  if (!first) throw new Error('Empty image response');
  onProgress?.(100, false);
  return {
    b64: first.b64,
    url: first.url,
    revisedPrompt: first.revisedPrompt,
    images: mapped.length > 1 ? mapped : undefined,
  };
}

export function imageResultToMarkdown(result: ImageGenResult, prompt: string): string {
  if (result.b64) {
    return `![${prompt.slice(0, 80)}](data:image/png;base64,${result.b64})`;
  }
  if (result.url) {
    return `![${prompt.slice(0, 80)}](${result.url})\n\nurl: ${result.url}`;
  }
  return 'no image data';
}

export async function pingImageEndpoint(
  settings: ClientSettings,
  abortSignal?: AbortSignal,
): Promise<{ ok: boolean; note: string; availableModels?: string[] }> {
  const url = imageEndpointUrl(settings, '/models');
  const headers: Record<string, string> = {};
  const token = (settings.imageToken || '').trim();
  if (token) headers.Authorization = 'Bearer ' + token;
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: abortSignal });
    let availableModels: string[] | undefined;
    try {
      const body = (await res.json()) as {
        available?: string[];
        availableModels?: string[];
        data?: Array<{ id?: string; available?: boolean; ready?: boolean }>;
      };
      if (Array.isArray(body.available)) {
        availableModels = body.available.filter((x): x is string => typeof x === 'string');
      } else if (Array.isArray(body.availableModels)) {
        availableModels = body.availableModels.filter((x): x is string => typeof x === 'string');
      } else if (Array.isArray(body.data)) {
        availableModels = body.data
          .filter((d) => d && (d.available === true || d.ready === true) && typeof d.id === 'string')
          .map((d) => d.id as string);
        // Legacy bridges with no availability flags: treat listed ids as unknown (UI keeps Quality; secondaries muted until flagged).
        if (!body.data.some((d) => typeof d?.available === 'boolean' || typeof d?.ready === 'boolean')) {
          availableModels = undefined;
        }
      }
    } catch {
      /* non-JSON still means reachable */
    }
    // Prefer /health.availableModels when /models did not yield a filtered list.
    if (!availableModels?.length) {
      try {
        const healthUrl = imageEndpointUrl(settings, '').replace(/\/v1\/?$/, '') + '/health';
        const hr = await fetch(healthUrl, { method: 'GET', headers, signal: abortSignal });
        const hb = (await hr.json()) as { availableModels?: string[] };
        if (Array.isArray(hb.availableModels) && hb.availableModels.length) {
          availableModels = hb.availableModels.filter((x): x is string => typeof x === 'string');
        }
      } catch {
        /* health optional */
      }
    }
    // 5xx from Vite proxy usually means upstream :7860 is down — treat as offline.
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      return {
        ok: false,
        note: BRIDGE_OFFLINE_FRIENDLY + ` (HTTP ${res.status})`,
        availableModels: [],
      };
    }
    // Other HTTP responses mean the host answered.
    return { ok: true, note: `reachable HTTP ${res.status}`, availableModels };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, note: isBridgeOfflineError(msg) ? BRIDGE_OFFLINE_FRIENDLY : msg || 'unreachable' };
  }
}

export { imageEndpointUrl };
