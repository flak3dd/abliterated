/**
 * Token pool for the IDE's built-in unrestricted model
 * (Abliteration / api.abliteration.ai). Authoritative remaining comes from
 * POST /api/billing/wallet; localStorage is a display cache only.
 */
import type { ClientSettings } from '../types';
import { resolveActiveSettings, type ActiveEndpoint } from './activeEndpoint';
import { fetchBillingWallet, getOrCreateDeviceId, type BillingWallet } from './billingApi';
import { getLicenseState, type LicenseState } from './license';

export const BUILTIN_USAGE_KEY = 'ablit_builtin_tokens';
export const WALLET_CACHE_KEY = 'ablit_wallet';
const WALLET_STALE_MS = 72 * 60 * 60 * 1000;

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
  if (active.provider === 'abliteration' || active.provider === 'platform') return true;
  try {
    const host = new URL(active.baseUrl).hostname.toLowerCase();
    return (
      host === 'api.abliteration.ai' ||
      host === 'abliterated.app' ||
      host === 'gateway.abliterated.app'
    );
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

export function loadWalletCache(): BillingWallet | null {
  try {
    const raw = localStorage.getItem(WALLET_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BillingWallet;
    if (!parsed || typeof parsed.remaining !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveWalletCache(wallet: BillingWallet): void {
  try {
    localStorage.setItem(WALLET_CACHE_KEY, JSON.stringify(wallet));
  } catch {
    /* quota */
  }
}

export function walletCacheFresh(wallet: BillingWallet | null, maxAge = WALLET_STALE_MS): boolean {
  if (!wallet || !wallet.fetchedAt) return false;
  return Date.now() - wallet.fetchedAt < maxAge;
}

export async function refreshBuiltinWallet(settings: ClientSettings): Promise<BillingWallet | null> {
  const license = getLicenseState(settings);
  if (license.isFree || license.tier === 'admin') return loadWalletCache();
  const key = (settings.licenseKey || '').trim();
  const loginId = (settings.loginId || '').trim();
  if (!key && !loginId) return loadWalletCache();
  try {
    const wallet = await fetchBillingWallet(settings, {
      deviceId: getOrCreateDeviceId(settings.deviceId),
      licenseKey: key || undefined,
      loginId: loginId || undefined,
    });
    saveWalletCache(wallet);
    return wallet;
  } catch {
    return loadWalletCache();
  }
}

export function remainingBuiltinTokens(license: LicenseState, usage = loadBuiltinUsage()): number {
  if (license.tier === 'admin') return Number.POSITIVE_INFINITY;
  const wallet = loadWalletCache();
  if (wallet && walletCacheFresh(wallet)) {
    return Math.max(0, wallet.remaining);
  }
  const cap = license.features.maxIncludedTokens;
  if (!Number.isFinite(cap)) return Number.POSITIVE_INFINITY;
  if (cap === 0) return 0;
  if (wallet && !walletCacheFresh(wallet) && Date.now() - wallet.fetchedAt < WALLET_STALE_MS) {
    return Math.max(0, wallet.remaining);
  }
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
      'The built-in unrestricted model is included with Starter, Pro, and Team. Activate a license, or switch to Featherless.ai for frontier abliterated uncensored models.',
    );
  }
  const left = remainingBuiltinTokens(license);
  if (left <= 0) {
    const wallet = loadWalletCache();
    const pool = wallet
      ? `${formatTokenCount(wallet.remaining)} remaining on the server wallet`
      : `${formatTokenCount(cap)} on ${license.label}`;
    throw new Error(
      `Built-in unrestricted model token pool exhausted (${pool}). Wait for the next billing period, buy credits, or switch to Featherless.ai.`,
    );
  }
}
