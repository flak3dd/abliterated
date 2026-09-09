import type { ClientSettings } from '../types';
import { endpointUrl } from './apiUrl';
import { resolveSparkImageModel } from './sparkInstall';
import {
  buildXaiImageBody,
  isXaiImageBackend,
  resolveXaiImageModel,
  xaiImageEndpointUrl,
  xaiImageRequestPath,
} from './xaiImage';

export type ImageGenArgs = {
  settings: ClientSettings;
  /** May be empty for ID jobs — Spark composes the document prompt from intent + extra. */
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
  /** Identity face (base64) for ID faceswap on the Edit path. */
  idImageB64?: string;
  /** ID-document metadata forwarded in extra (type / ISO country). */
  idType?: string;
  country?: string;
  /** ID look: capture (timber phone photo) or alter (img2img flatten/deglare). */
  idLook?: string;
  abortSignal?: AbortSignal;
  /** Optional progress callback. `estimated` is true when value is client-side only. */
  onProgress?: (percent: number, estimated: boolean, info?: { status?: string }) => void;
};

export type ImageGenResult = {
  b64?: string;
  url?: string;
  revisedPrompt?: string;
  /** Present when the API returned multiple images (n>1). First entry matches top-level fields. */
  images?: Array<{ b64?: string; url?: string; revisedPrompt?: string }>;
};

function imageEndpointUrl(settings: ClientSettings, suffix: string): string {
  if (isXaiImageBackend(settings)) return xaiImageEndpointUrl(settings, suffix);
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
  // 503 from the bridge is often "weights not present", not a dead proxy.
  return /bridge offline|Image server unreachable|Image fetch failed|ECONNREFUSED|ENOTFOUND|socket hang up|HTTP 502|HTTP 504|Failed to fetch|NetworkError|Load failed/i.test(
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

export const REF_MAX_EDGE = 2048;
export const FACE_MAX_EDGE = 1024;

export function parseSizeMaxEdge(size: string): number {
  const m = /^(\d+)\s*x\s*(\d+)$/i.exec((size || '').trim());
  if (!m) return 1024;
  return Math.max(64, parseInt(m[1], 10) || 1024, parseInt(m[2], 10) || 1024);
}

function b64FromDataUrl(dataUrl: string): string {
  const s = (dataUrl || '').trim();
  const i = s.indexOf(',');
  return i >= 0 ? s.slice(i + 1) : s;
}

function canUseCanvas(): boolean {
  return typeof document !== 'undefined' && typeof Image !== 'undefined';
}

/** Cap long edge and re-encode so edit/ID jobs do not POST multi-megapixel PNG blobs. */
export async function compactImageB64(
  raw: string,
  opts: { maxEdge: number; format: 'jpeg' | 'png'; quality?: number },
): Promise<string> {
  const trimmed = (raw || '').trim();
  if (!trimmed || !canUseCanvas()) return trimmed;
  const src = trimmed.startsWith('data:')
    ? trimmed
    : `data:${trimmed.startsWith('iVBOR') ? 'image/png' : trimmed.startsWith('UklGR') ? 'image/webp' : 'image/jpeg'};base64,${trimmed}`;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('ref decode failed'));
      el.src = src;
    });
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (!w || !h) return trimmed.includes(',') ? b64FromDataUrl(trimmed) : trimmed;
    const maxE = Math.max(64, opts.maxEdge);
    const m = Math.max(w, h);
    if (m > maxE) {
      const scale = maxE / m;
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return trimmed.includes(',') ? b64FromDataUrl(trimmed) : trimmed;
    ctx.drawImage(img, 0, 0, w, h);
    const mime = opts.format === 'png' ? 'image/png' : 'image/jpeg';
    const dataUrl = canvas.toDataURL(mime, opts.format === 'jpeg' ? (opts.quality ?? 0.9) : undefined);
    return b64FromDataUrl(dataUrl);
  } catch {
    return trimmed.includes(',') ? b64FromDataUrl(trimmed) : trimmed;
  }
}

/** Ingest drop/file: cap 2048, JPEG for photos, PNG for scans. */
export async function compactFileToDataUrl(file: File, maxEdge = REF_MAX_EDGE): Promise<string> {
  const keepPng = /png|webp/i.test(file.type);
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      try {
        let w = bitmap.width;
        let h = bitmap.height;
        const m = Math.max(w, h);
        if (m > maxEdge) {
          const scale = maxEdge / m;
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas');
        ctx.drawImage(bitmap, 0, 0, w, h);
        return keepPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.92);
      } finally {
        bitmap.close();
      }
    }
  } catch {
    /* FileReader fallback */
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(file);
  });
  const b64 = await compactImageB64(dataUrl, {
    maxEdge,
    format: keepPng ? 'png' : 'jpeg',
    quality: 0.92,
  });
  return keepPng ? `data:image/png;base64,${b64}` : `data:image/jpeg;base64,${b64}`;
}

function isXaiRequestUrl(requestUrl: string): boolean {
  return /api\.x\.ai|\/xai-v1(?:\/|$)/i.test(requestUrl || '');
}

function friendlyHttpError(status: number, body: string, requestUrl: string): string {
  const clipped = (body || '').trim().slice(0, 400);
  const looksEmpty = !clipped;
  if (isXaiRequestUrl(requestUrl)) {
    if (status === 401 || status === 403) {
      return `xAI rejected the API key (HTTP ${status}). Paste a key from console.x.ai on Images → Endpoint.\nRequest: ${requestUrl}${clipped ? `\n${clipped}` : ''}`;
    }
    return `xAI HTTP ${status}: ${clipped || '(empty body)'}\nRequest: ${requestUrl}`;
  }
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
  onProgress: (percent: number, estimated: boolean, info?: { status?: string }) => void,
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
      const json = (await res.json()) as { progress?: number; percent?: number; status?: string };
      const status = typeof json.status === 'string' ? json.status : undefined;
      // Ignore stale idle from a prior job so we do not flash 0% as "real".
      if (status === 'idle') return;
      const raw = typeof json.progress === 'number' ? json.progress : json.percent;
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        const pct = Math.min(99, Math.max(0, Math.round(raw)));
        onProgress(pct, false, status ? { status } : undefined);
      }
    } catch {
      /* optional endpoint */
    }
  };
  void tick();
  const id = window.setInterval(() => void tick(), 800);
  return () => {
    stopped = true;
    window.clearInterval(id);
  };
}

async function generateXaiImage(args: ImageGenArgs): Promise<ImageGenResult> {
  const { settings, prompt, size = '1024x1024', n = 1, model, imageB64, idImageB64, abortSignal, onProgress } = args;
  const token = (settings.xaiImageToken || '').trim();
  if (!token) {
    throw new Error('xAI API key is missing. Paste it on Images → Endpoint (xAI Imagine), or set XAI_API_KEY in the environment for local scripts.');
  }
  const refs = [imageB64, idImageB64].map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
  const compactRefs = await Promise.all(
    refs.map((raw) => compactImageB64(raw, { maxEdge: REF_MAX_EDGE, format: 'jpeg', quality: 0.92 })),
  );
  const body = buildXaiImageBody({
    model: resolveXaiImageModel(model, settings.xaiImageModel),
    prompt,
    n,
    size,
    resolution: settings.xaiImageResolution === '1k' ? '1k' : '2k',
    quality: settings.xaiImageQuality,
    imageB64s: compactRefs,
  });
  const url = xaiImageEndpointUrl(settings, xaiImageRequestPath(body));
  onProgress?.(8, true, { status: 'waiting' });
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify(body),
      signal: abortSignal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    if (err instanceof Error && err.name === 'AbortError') throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`xAI image request failed: ${msg}\nRequest: ${url}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(friendlyHttpError(res.status, text, url));
  }
  let json: { data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new Error('Invalid JSON from xAI image endpoint');
  }
  const mapped = (json.data || [])
    .map((d) => ({
      b64: d.b64_json || undefined,
      url: d.url || undefined,
      revisedPrompt: d.revised_prompt || undefined,
    }))
    .filter((d) => d.b64 || d.url);
  const first = mapped[0];
  if (!first) throw new Error('Empty image response from xAI');
  if (!first.b64 && first.url) {
    try {
      const imgRes = await fetch(first.url, { signal: abortSignal });
      if (imgRes.ok) {
        const buf = await imgRes.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        first.b64 = btoa(bin);
      }
    } catch {
      /* keep url */
    }
  }
  onProgress?.(100, false, { status: 'done' });
  return {
    b64: first.b64,
    url: first.url,
    revisedPrompt: first.revisedPrompt,
    images: mapped.length > 1 ? mapped : undefined,
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
    idImageB64,
    idType,
    country,
    idLook,
    abortSignal,
    onProgress,
  } = args;
  if (!settings.imageGenEnabled) {
    throw new Error('Image generation is disabled. Enable it in Settings / Images (see spark-image/).');
  }
  const xai = isXaiImageBackend(settings);
  if (xai) {
    return generateXaiImage(args);
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
  }
  if (typeof guidance === 'number' && Number.isFinite(guidance)) {
    body.guidance = guidance;
    body.guidance_scale = guidance;
  }
  if (typeof loraStrength === 'number' && Number.isFinite(loraStrength)) {
    body.lora_strength = loraStrength;
  }
  if (typeof negative === 'string' && negative.trim()) {
    body.negative = negative.trim();
  }
  const intentTrim = typeof intent === 'string' ? intent.trim() : '';
  if (intentTrim) body.intent = intentTrim;
  const idJob = /^id[_-]/i.test(intentTrim);
  const canvasEdge = parseSizeMaxEdge(size);
  const refB64 = typeof imageB64 === 'string' ? imageB64.trim() : '';
  const idB64 = typeof idImageB64 === 'string' ? idImageB64.trim() : '';
  const [compactRef, compactId] = await Promise.all([
    refB64
      ? compactImageB64(refB64, {
          maxEdge: idJob ? REF_MAX_EDGE : canvasEdge,
          format: idJob ? 'png' : 'jpeg',
          quality: 0.9,
        })
      : Promise.resolve(''),
    idB64
      ? compactImageB64(idB64, { maxEdge: FACE_MAX_EDGE, format: 'jpeg', quality: 0.9 })
      : Promise.resolve(''),
  ]);
  // One copy each — extra used to duplicate 2–4× and stall JSON.stringify on LAN.
  if (compactRef) body.image = compactRef;
  if (compactId) body.id_image = compactId;
  if (typeof idType === 'string' && idType.trim()) extra.id_type = idType.trim();
  if (typeof country === 'string' && country.trim()) extra.country = country.trim();
  if (typeof idLook === 'string' && idLook.trim()) extra.id_look = idLook.trim();
  if (Object.keys(extra).length > 0) body.extra = extra;

  let stopPoll: (() => void) | undefined;
  if (onProgress) {
    onProgress(0, true, { status: 'waiting' });
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
  onProgress?.(100, false, { status: 'done' });
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
  const xai = isXaiImageBackend(settings);
  const url = imageEndpointUrl(settings, '/models');
  const headers: Record<string, string> = {};
  const token = ((xai ? settings.xaiImageToken : settings.imageToken) || '').trim();
  if (xai && !token) {
    return {
      ok: false,
      note: 'xAI API key is missing. Paste it on Images → Endpoint (xAI Imagine).',
    };
  }
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
    // Spark bridge only — xAI has no /health and CORS-proxies 404 it.
    if (!xai && !availableModels?.length) {
      try {
        const healthUrl = imageEndpointUrl(settings, '/health');
        const hr = await fetch(healthUrl, { method: 'GET', headers, signal: abortSignal });
        const hb = (await hr.json()) as { availableModels?: string[] };
        if (Array.isArray(hb.availableModels) && hb.availableModels.length) {
          availableModels = hb.availableModels.filter((x): x is string => typeof x === 'string');
        }
      } catch {
        /* health optional */
      }
    }
    if (xai && (res.status === 401 || res.status === 403)) {
      return { ok: false, note: `xAI rejected the API key (HTTP ${res.status})` };
    }
    // Vite proxy 502/504 (empty/connect) means upstream :7860 is down.
    // 503 from /models can be a live bridge with a missing secondary model — not offline.
    if (res.status === 502 || res.status === 504) {
      return {
        ok: false,
        note: xai
          ? `xAI proxy/upstream failed (HTTP ${res.status})`
          : BRIDGE_OFFLINE_FRIENDLY + ` (HTTP ${res.status})`,
        availableModels: [],
      };
    }
    // Other HTTP responses mean the host answered.
    return { ok: true, note: xai ? `xAI reachable HTTP ${res.status}` : `reachable HTTP ${res.status}`, availableModels };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (xai) return { ok: false, note: msg || 'xAI unreachable' };
    return { ok: false, note: isBridgeOfflineError(msg) ? BRIDGE_OFFLINE_FRIENDLY : msg || 'unreachable' };
  }
}

export { imageEndpointUrl };
