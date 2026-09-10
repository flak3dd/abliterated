/** Output canvas size from aspect ratio + long edge. Keep in lockstep with sampler_runtime.size_from_ratio. */

export const LONG_EDGES = [512, 768, 1024, 1328, 1536, 1920] as const;
export type LongEdge = (typeof LONG_EDGES)[number];

export const IMAGE_RATIOS = [
  { id: 'auto', label: 'Auto', w: 0, h: 0 },
  { id: '1:1', label: '1:1', w: 1, h: 1 },
  { id: '4:3', label: '4:3', w: 4, h: 3 },
  { id: '3:4', label: '3:4', w: 3, h: 4 },
  { id: '3:2', label: '3:2', w: 3, h: 2 },
  { id: '2:3', label: '2:3', w: 2, h: 3 },
  { id: '16:9', label: '16:9', w: 16, h: 9 },
  { id: '9:16', label: '9:16', w: 9, h: 16 },
] as const;

export type RatioId = (typeof IMAGE_RATIOS)[number]['id'];

export function snap8(n: number): number {
  return Math.max(64, Math.round(n / 8) * 8);
}

export function sizeFromRatio(rw: number, rh: number, longEdge: number): string {
  const le = Math.max(64, Math.round(longEdge) || 1024);
  const aw = Math.max(1, rw);
  const ah = Math.max(1, rh);
  if (aw >= ah) return `${snap8(le)}x${snap8((le * ah) / aw)}`;
  return `${snap8((le * aw) / ah)}x${snap8(le)}`;
}

export function parseSize(size: string): { width: number; height: number } {
  const m = /^(\d+)\s*x\s*(\d+)$/i.exec((size || '').trim());
  if (!m) return { width: 1024, height: 1024 };
  return { width: Math.max(64, parseInt(m[1], 10) || 1024), height: Math.max(64, parseInt(m[2], 10) || 1024) };
}

export function longEdgeOf(size: string): number {
  const { width, height } = parseSize(size);
  return Math.max(width, height);
}

export function nearestLongEdge(n: number): LongEdge {
  let best: LongEdge = 1024;
  let err = Infinity;
  for (const e of LONG_EDGES) {
    const d = Math.abs(e - n);
    if (d < err) {
      err = d;
      best = e;
    }
  }
  return best;
}

export function nearestRatioId(width: number, height: number): RatioId {
  const r = width / Math.max(1, height);
  let best: RatioId = '1:1';
  let err = Infinity;
  for (const p of IMAGE_RATIOS) {
    if (p.id === 'auto' || !p.w || !p.h) continue;
    const e = Math.abs(r - p.w / p.h);
    if (e < err) {
      err = e;
      best = p.id;
    }
  }
  return err < 0.05 ? best : 'auto';
}

/** Largest snap8 WxH with ratio rw:rh that fits in the media box. */
export function fitSizeInside(rw: number, rh: number, boxW: number, boxH: number): { width: number; height: number } {
  const aw = Math.max(1, rw);
  const ah = Math.max(1, rh);
  const bw = Math.max(64, boxW);
  const bh = Math.max(64, boxH);
  const scale = Math.min(bw / aw, bh / ah);
  return { width: snap8(aw * scale), height: snap8(ah * scale) };
}

export function sizeForRatio(ratioId: RatioId, longEdge: number, source?: { width: number; height: number } | null): string {
  if (ratioId === 'auto') {
    if (source && source.width > 0 && source.height > 0) {
      return sizeFromRatio(source.width, source.height, longEdge);
    }
    return sizeFromRatio(1, 1, longEdge);
  }
  const p = IMAGE_RATIOS.find((x) => x.id === ratioId);
  if (!p || !p.w || !p.h) return sizeFromRatio(1, 1, longEdge);
  return sizeFromRatio(p.w, p.h, longEdge);
}
