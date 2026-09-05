import { resolveActiveSettings } from './activeEndpoint';
import { endpointUrl } from './apiUrl';
import type { ClientSettings } from '../types';

export type HealthState = 'unknown' | 'ok' | 'down';

export type ProviderHealthMap = {
  abliteration: HealthState;
  spark: HealthState;
  featherless: HealthState;
  image: HealthState;
};

export type ProviderHealthEntry = {
  key: keyof ProviderHealthMap;
  label: string;
  state: HealthState;
};

const POLL_MS = 30_000;
const TIMEOUT_MS = 4_000;

let current: ProviderHealthMap = {
  abliteration: 'unknown',
  spark: 'unknown',
  featherless: 'unknown',
  image: 'unknown',
};
let settingsSnapshot: ClientSettings | null = null;
let timer: number | null = null;
let polling = false;
const listeners = new Set<(h: ProviderHealthMap) => void>();

function notify(): void {
  listeners.forEach((cb) => cb(current));
}

/** Any HTTP response counts as reachable; only network failure / timeout means down. */
async function probe(url: string, token: string): Promise<HealthState> {
  const ac = new AbortController();
  const t = window.setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'X-Retention': 'none' };
    if (token.trim()) headers.Authorization = 'Bearer ' + token.trim();
    await fetch(url, { headers, signal: ac.signal });
    return 'ok';
  } catch {
    return 'down';
  } finally {
    window.clearTimeout(t);
  }
}

async function pollOnce(): Promise<void> {
  const s = settingsSnapshot;
  if (!s || polling) return;
  polling = true;
  const next: ProviderHealthMap = { ...current };
  const tasks: Array<Promise<void>> = [];

  if (s.baseUrl?.trim()) {
    const url = endpointUrl({ baseUrl: s.baseUrl }, '/models');
    tasks.push(
      probe(url, s.token).then((r) => {
        next.abliteration = r;
      }),
    );
  } else {
    next.abliteration = 'unknown';
  }

  if (s.sparkEnabled && s.sparkBaseUrl?.trim()) {
    const url = endpointUrl(
      { baseUrl: s.sparkBaseUrl, sparkViaProxy: s.sparkViaProxy, inferenceProvider: 'dgx-spark' },
      '/models',
    );
    tasks.push(
      probe(url, s.sparkToken).then((r) => {
        next.spark = r;
      }),
    );
  } else {
    next.spark = 'unknown';
  }

  if (s.featherlessEnabled !== false && s.featherlessBaseUrl?.trim()) {
    const url = endpointUrl(
      {
        baseUrl: s.featherlessBaseUrl,
        featherlessViaProxy: s.featherlessViaProxy,
        inferenceProvider: 'featherless',
      },
      '/models',
    );
    tasks.push(
      probe(url, s.featherlessToken).then((r) => {
        next.featherless = r;
      }),
    );
  } else {
    next.featherless = 'unknown';
  }

  if (s.imageGenEnabled && s.imageBaseUrl?.trim()) {
    const base = s.imageBaseUrl.replace(/\/$/, '');
    tasks.push(
      probe(`${base}/models`, s.imageToken).then((r) => {
        next.image = r;
      }),
    );
  } else {
    next.image = 'unknown';
  }

  try {
    await Promise.all(tasks);
    current = next;
    notify();
  } finally {
    polling = false;
  }
}

export function getProviderHealth(): ProviderHealthMap {
  return current;
}

export function subscribeProviderHealth(cb: (h: ProviderHealthMap) => void): () => void {
  listeners.add(cb);
  cb(current);
  return () => listeners.delete(cb);
}

/** Feed the latest settings; triggers an immediate re-poll. */
export function setHealthSettings(s: ClientSettings): void {
  settingsSnapshot = s;
  startProviderHealth();
  void pollOnce();
}

export const setProviderHealthSettingsSnapshot = setHealthSettings;

export function startProviderHealth(): void {
  if (timer != null) return;
  timer = window.setInterval(() => void pollOnce(), POLL_MS);
}

export function stopProviderHealth(): void {
  if (timer != null) {
    window.clearInterval(timer);
    timer = null;
  }
}

/** Convert a ProviderHealthMap to list of entries for StatusBar rendering */
export function healthMapToEntries(
  map: ProviderHealthMap,
  settings?: ClientSettings | null,
): ProviderHealthEntry[] {
  const s = settings ?? settingsSnapshot;
  if (!s) {
    return [
      { key: 'abliteration', label: 'ablit', state: map.abliteration },
      { key: 'spark', label: 'spark', state: map.spark },
      { key: 'featherless', label: 'featherless', state: map.featherless },
    ];
  }
  const out: ProviderHealthEntry[] = [];
  const active = resolveActiveSettings(s);
  const push = (key: keyof ProviderHealthMap, label: string) => {
    out.push({ key, label, state: map[key] });
  };
  if (active.provider === 'abliteration' || active.provider === 'custom') push('abliteration', active.label);
  else push(active.provider === 'dgx-spark' ? 'spark' : 'featherless', active.label);
  if (s.sparkEnabled && active.provider !== 'dgx-spark') push('spark', 'spark');
  if (s.featherlessEnabled !== false && active.provider !== 'featherless') push('featherless', 'featherless');
  if (s.imageGenEnabled) push('image', 'images');
  return out;
}

/** Dots worth showing: active provider always; optional endpoints when enabled. */
export function healthEntriesForSettings(s: ClientSettings): ProviderHealthEntry[] {
  return healthMapToEntries(current, s);
}

