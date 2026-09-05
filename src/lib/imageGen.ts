import type { ClientSettings } from '../types';
import { endpointUrl } from './apiUrl';

export type ImageGenArgs = {
  settings: ClientSettings;
  prompt: string;
  size?: string;
  n?: number;
  model?: string;
  abortSignal?: AbortSignal;
  /** Optional progress callback. `estimated` is true when value is client-side only. */
  onProgress?: (percent: number, estimated: boolean) => void;
};

export type ImageGenResult = {
  b64?: string;
  url?: string;
  revisedPrompt?: string;
};

function imageEndpointUrl(settings: ClientSettings, suffix: string): string {
  const base = (settings.imageBaseUrl || 'http://127.0.0.1:7860/v1').replace(/\/$/, '');
  const pathSuffix = suffix.startsWith('/') ? suffix : '/' + suffix;
  const joined = base + pathSuffix;

  if (import.meta.env.DEV && settings.imageViaProxy !== false) {
    try {
      const url = new URL(joined);
      const port = url.port || (url.protocol === 'https:' ? '443' : '80');
      const local =
        (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
        (port === '7860' || settings.imageViaProxy === true);
      if (local || settings.imageViaProxy === true) {
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

function friendlyHttpError(status: number, body: string, requestUrl: string): string {
  const clipped = (body || '').trim().slice(0, 400);
  const looksEmpty = !clipped;
  const looksProxyFail =
    status === 500 || status === 502 || status === 503 || status === 504;
  if (looksProxyFail && (looksEmpty || /ECONNREFUSED|ENOTFOUND|socket hang up|connect/i.test(clipped))) {
    return [
      `Image server unreachable (HTTP ${status}).`,
      'Nothing is listening on the image base URL (default http://127.0.0.1:7860).',
      'Start a mock: `cd spark-image && ABLITERATED_IMAGE_MOCK=1 python3 serve-openai-bridge.py`',
      'Or full FLUX on a GPU host — see spark-image/README.md.',
      `Request: ${requestUrl}`,
    ].join('\n');
  }
  if (status === 404) {
    return [
      `HTTP 404 from image endpoint — wrong path or host (not /v1/images/generations).`,
      'api.abliteration.ai has no image *generation* API (vision input only).',
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
  const { settings, prompt, size = '1024x1024', n = 1, model, abortSignal, onProgress } = args;
  if (!settings.imageGenEnabled) {
    throw new Error('Image generation is disabled. Enable it in Settings / Images (see spark-image/).');
  }
  const url = imageEndpointUrl(settings, '/images/generations');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = (settings.imageToken || '').trim();
  if (token) headers.Authorization = 'Bearer ' + token;

  const body = {
    model: (model || settings.imageModel || 'abliterated-flux-klein').trim(),
    prompt,
    size,
    n: Math.min(4, Math.max(1, Math.floor(n) || 1)),
    response_format: 'b64_json',
  };

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
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      [
        `Image fetch failed: ${msg}`,
        'Start mock: `cd spark-image && ABLITERATED_IMAGE_MOCK=1 python3 serve-openai-bridge.py`',
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
  const first = json.data?.[0];
  if (!first) throw new Error('Empty image response');
  onProgress?.(100, false);
  return {
    b64: first.b64_json || undefined,
    url: first.url || undefined,
    revisedPrompt: first.revised_prompt || undefined,
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

export { imageEndpointUrl };
