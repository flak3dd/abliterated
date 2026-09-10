/** Optional xAI Grok Imagine image endpoint (cloud). Spark local bridge stays default. */

import type { ClientSettings } from '../types';

function parseWxH(size: string): { width: number; height: number } {
  const m = /^(\d+)\s*x\s*(\d+)$/i.exec((size || '').trim());
  if (!m) return { width: 1024, height: 1024 };
  return { width: Math.max(64, parseInt(m[1], 10) || 1024), height: Math.max(64, parseInt(m[2], 10) || 1024) };
}

export const XAI_IMAGE_BASE_URL = 'https://api.x.ai/v1';
export const XAI_IMAGE_MODEL = 'grok-imagine-image-2.0';

export type ImageBackend = 'spark' | 'xai';
export type XaiImageResolution = '1k' | '2k';
export type XaiImageQuality = 'auto' | 'low' | 'medium';

export const XAI_RESOLUTIONS: readonly XaiImageResolution[] = ['1k', '2k'];
export const XAI_QUALITIES: readonly XaiImageQuality[] = ['auto', 'low', 'medium'];

/** Ratios accepted by grok-imagine-image-2.0. */
export const XAI_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '2:1',
  '1:2',
  '19.5:9',
  '9:19.5',
  '20:9',
  '9:20',
  '21:9',
  '5:2',
  'auto',
] as const;

export type XaiAspectRatio = (typeof XAI_ASPECT_RATIOS)[number];

export function isXaiImageBackend(settings: Pick<ClientSettings, 'imageBackend'>): boolean {
  return settings.imageBackend === 'xai';
}

export function xaiImageSettingsPatch(
  settings: ClientSettings,
  extra?: Partial<Pick<ClientSettings, 'xaiImageModel' | 'xaiImageResolution' | 'xaiImageQuality'>>,
): Partial<ClientSettings> {
  return {
    imageGenEnabled: true,
    imageBackend: 'xai',
    xaiImageBaseUrl: settings.xaiImageBaseUrl?.trim() || XAI_IMAGE_BASE_URL,
    xaiImageModel: extra?.xaiImageModel?.trim() || settings.xaiImageModel?.trim() || XAI_IMAGE_MODEL,
    xaiImageResolution: extra?.xaiImageResolution || settings.xaiImageResolution || '2k',
    xaiImageQuality: extra?.xaiImageQuality || settings.xaiImageQuality || 'auto',
  };
}

/** DEV rewrite: https://api.x.ai/v1/foo → /xai-v1/foo */
export function xaiDevProxyPath(joined: string): string {
  try {
    const url = new URL(joined);
    if (url.hostname !== 'api.x.ai') return joined;
    let path = url.pathname || '/';
    if (path.startsWith('/v1')) path = '/xai-v1' + path.slice(3);
    else if (path === '/' || path === '') path = '/xai-v1';
    else path = '/xai-v1' + (path.startsWith('/') ? path : '/' + path);
    return path + url.search;
  } catch {
    return joined;
  }
}

export function xaiImageEndpointUrl(settings: ClientSettings, suffix: string): string {
  const base = (settings.xaiImageBaseUrl || XAI_IMAGE_BASE_URL).replace(/\/$/, '');
  const pathSuffix = suffix.startsWith('/') ? suffix : '/' + suffix;
  const joined = base + pathSuffix;
  const viteDev = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  if (viteDev) return xaiDevProxyPath(joined);
  return joined;
}

export function sizeToXaiAspectRatio(size: string): XaiAspectRatio {
  const { width, height } = parseWxH(size);
  if (!width || !height) return 'auto';
  const r = width / height;
  let best: XaiAspectRatio = '1:1';
  let err = Infinity;
  for (const id of XAI_ASPECT_RATIOS) {
    if (id === 'auto') continue;
    const [aw, ah] = id.split(':').map(Number);
    if (!aw || !ah) continue;
    const e = Math.abs(r - aw / ah);
    if (e < err) {
      err = e;
      best = id;
    }
  }
  return err < 0.08 ? best : 'auto';
}

export function dataUrlFromB64(b64: string): string {
  const t = (b64 || '').trim();
  if (!t) return '';
  if (t.startsWith('data:')) return t;
  const mime = t.startsWith('iVBOR') ? 'image/png' : t.startsWith('UklGR') ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${t}`;
}

export type XaiImageRef = { url: string; type: 'image_url' };

export type XaiImageBody = {
  model: string;
  prompt: string;
  n: number;
  response_format: 'b64_json';
  aspect_ratio?: XaiAspectRatio;
  resolution?: XaiImageResolution;
  quality?: XaiImageQuality;
  /** Single-image edit (`POST /v1/images/edits`). */
  image?: XaiImageRef;
  /** Multi-image edit, max 5 (`POST /v1/images/edits`). Official field is `images`. */
  images?: XaiImageRef[];
};

/** Spark Diffusers ids must never be posted to api.x.ai. */
export function looksLikeXaiImageModel(id: string): boolean {
  const t = (id || '').trim().toLowerCase();
  return t.startsWith('grok-imagine') || t.startsWith('grok-2-image') || t.startsWith('grok-image');
}

export function resolveXaiImageModel(requested?: string, fallback?: string): string {
  if (looksLikeXaiImageModel(requested || '')) return (requested || '').trim();
  if (looksLikeXaiImageModel(fallback || '')) return (fallback || '').trim();
  return XAI_IMAGE_MODEL;
}

export function buildXaiImageBody(opts: {
  model?: string;
  prompt: string;
  n?: number;
  size?: string;
  resolution?: XaiImageResolution;
  quality?: XaiImageQuality;
  imageB64s?: string[];
}): XaiImageBody {
  const refs = (opts.imageB64s || []).map(dataUrlFromB64).filter(Boolean);
  const body: XaiImageBody = {
    model: resolveXaiImageModel(opts.model),
    prompt: opts.prompt || '',
    n: Math.min(10, Math.max(1, Math.floor(opts.n || 1))),
    response_format: 'b64_json',
    resolution: opts.resolution === '1k' ? '1k' : '2k',
    quality: opts.quality && XAI_QUALITIES.includes(opts.quality) ? opts.quality : 'auto',
  };
  const aspect = opts.size ? sizeToXaiAspectRatio(opts.size) : 'auto';
  if (aspect) body.aspect_ratio = aspect;
  if (refs.length === 1) body.image = { url: refs[0], type: 'image_url' };
  else if (refs.length > 1) {
    body.images = refs.slice(0, 5).map((url) => ({ url, type: 'image_url' as const }));
  }
  return body;
}

export function xaiImageRequestPath(body: XaiImageBody): '/images/generations' | '/images/edits' {
  if (body.image) return '/images/edits';
  if (body.images && body.images.length > 0) return '/images/edits';
  return '/images/generations';
}
