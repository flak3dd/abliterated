/**
 * Monthly token pool for the IDE's built-in unrestricted model
 * (Abliteration / api.abliteration.ai). BYO endpoints do not count.
 */
import type { ClientSettings } from '../types';
import { resolveActiveSettings, type ActiveEndpoint } from './activeEndpoint';
import { getLicenseState, type LicenseState } from './license';

export const BUILTIN_USAGE_KEY = 'ablit_builtin_tokens';

export type BuiltinTokenUsage = {
  /** Calendar month key YYYY-MM */
  period: string;
  used: number;
};

export function currentTokenPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function isBuiltinEndpoint(active: ActiveEndpoint): boolean {
  if (active.provider === 'abliteration') return true;
  try {
    return new URL(active.baseUrl).hostname.toLowerCase() === 'api.abliteration.ai';
  } catch {
    return false;
  }
}

export function loadBuiltinUsage(): BuiltinTokenUsage {
  const period = currentTokenPeriod();
  try {
    const raw = localStorage.getItem(BUILTIN_USAGE_KEY);
    if (!raw) return { period, used: 0 };
    const parsed = JSON.parse(raw) as BuiltinTokenUsage;
    if (!parsed || parsed.period !== period) return { period, used: 0 };
    const used = Number(parsed.used);
    return { period, used: Number.isFinite(used) && used > 0 ? used : 0 };
  } catch {
    return { period, used: 0 };
  }
}

export function recordBuiltinUsage(tokens: number): BuiltinTokenUsage {
  const next = loadBuiltinUsage();
  const add = Math.max(0, Math.floor(Number(tokens) || 0));
  next.used += add;
  try {
    localStorage.setItem(BUILTIN_USAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
  return next;
}

export function estimateTokensFromText(text: string): number {
  const n = text?.length || 0;
  return Math.max(1, Math.ceil(n / 4));
}

export function remainingBuiltinTokens(license: LicenseState, usage = loadBuiltinUsage()): number {
  const cap = license.features.maxIncludedTokens;
  if (!Number.isFinite(cap)) return Number.POSITIVE_INFINITY;
  return Math.max(0, cap - usage.used);
}

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n)) return 'unlimited';
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return Number.isInteger(m) ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return String(Math.floor(n));
}

/** Throws if the built-in model is selected and the monthly pool is exhausted. */
export function assertBuiltinQuota(settings: ClientSettings): void {
  const active = resolveActiveSettings(settings);
  if (!isBuiltinEndpoint(active)) return;
  const license = getLicenseState(settings);
  const cap = license.features.maxIncludedTokens;
  if (cap === 0) {
    throw new Error(
      'The built-in unrestricted model is included with Starter, Pro, and Team. Activate a license, or switch to a BYO endpoint (Custom / Featherless / Spark).',
    );
  }
  const left = remainingBuiltinTokens(license);
  if (left <= 0) {
    throw new Error(
      `Built-in unrestricted model monthly token limit reached (${formatTokenCount(cap)} on ${license.label}). Wait for next month, upgrade, or switch to a BYO endpoint.`,
    );
  }
}
