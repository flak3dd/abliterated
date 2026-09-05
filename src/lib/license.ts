/**
 * Freemium license stub for Abliterated IDE.
 *
 * Keys are offline-verifiable with a **public client pepper** (not a secret).
 * Real issuance / revocation must be server-side (Stripe webhook → signed key).
 * This stub accepts prefix-based tiers for local testing only.
 */

export type LicenseTier = 'free' | 'starter' | 'pro' | 'team' | 'admin';

export type LicenseFeatures = {
  /** Free: 1; Pro/Team: unlimited (Number.POSITIVE_INFINITY). */
  maxWorkspaces: number;
  /** Free: 1; Pro/Team: unlimited. Soft-cap new enables in UI. */
  maxMcpServers: number;
  /** Free: 1; Pro/Team: 4. */
  maxConcurrentJobs: number;
  /** Free: 1; Pro/Team: 5 (matches MAX_SELF_DEEPEN_PASSES). */
  maxSelfDeepenPasses: number;
  planModeAllowed: boolean;
  showWatermark: boolean;
  priorityFeatures: boolean;
  /** Team placeholder — shared seat pool not enforced yet. */
  sharedSeats: boolean;
};

export type LicenseState = {
  tier: LicenseTier;
  features: LicenseFeatures;
  label: string;
  key: string;
  /** True when key is empty or unrecognized → Free. */
  isFree: boolean;
};

/** Public client pepper — document only; do not treat as a signing secret. */
export const LICENSE_CLIENT_PEPPER = 'ablit-public-client-pepper-v1-not-a-secret';

const UNLIMITED = Number.POSITIVE_INFINITY;

const TIER_FEATURES: Record<LicenseTier, LicenseFeatures> = {
  free: {
    maxWorkspaces: 1,
    maxMcpServers: 1,
    maxConcurrentJobs: 1,
    maxSelfDeepenPasses: 1,
    planModeAllowed: true,
    showWatermark: true,
    priorityFeatures: false,
    sharedSeats: false,
  },
  starter: {
    maxWorkspaces: 1,
    maxMcpServers: 1,
    maxConcurrentJobs: 1,
    maxSelfDeepenPasses: 1,
    planModeAllowed: false,
    showWatermark: true,
    priorityFeatures: false,
    sharedSeats: false,
  },
  pro: {
    maxWorkspaces: UNLIMITED,
    maxMcpServers: UNLIMITED,
    maxConcurrentJobs: 4,
    maxSelfDeepenPasses: 5,
    planModeAllowed: true,
    showWatermark: false,
    priorityFeatures: true,
    sharedSeats: false,
  },
  team: {
    maxWorkspaces: UNLIMITED,
    maxMcpServers: UNLIMITED,
    maxConcurrentJobs: 4,
    maxSelfDeepenPasses: 5,
    planModeAllowed: true,
    showWatermark: false,
    priorityFeatures: true,
    sharedSeats: true,
  },
  admin: {
    maxWorkspaces: UNLIMITED,
    maxMcpServers: UNLIMITED,
    maxConcurrentJobs: UNLIMITED,
    maxSelfDeepenPasses: 5,
    planModeAllowed: true,
    showWatermark: false,
    priorityFeatures: true,
    sharedSeats: true,
  },
};

const TIER_LABEL: Record<LicenseTier, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  team: 'Team',
  admin: 'Admin (dev)',
};

/** Local development admin — not a production identity. Override with VITE_ABLITERATED_ADMIN_*. */
export const ADMIN_LICENSE_KEY = 'ABLIT-ADMIN';

export function adminCredentials(): { username: string; password: string } {
  let envUser = '';
  let envPass = '';
  try {
    envUser = String(import.meta.env.VITE_ABLITERATED_ADMIN_USER || '').trim();
    envPass = String(import.meta.env.VITE_ABLITERATED_ADMIN_PASSWORD || '').trim();
  } catch {
    /* non-Vite */
  }
  return { username: envUser || 'admin', password: envPass || 'abliterated' };
}

/** Canonicalize known stub keys so `ablit-admin` still unlocks. */
export function normalizeLicenseKey(key: string): string {
  const k = key.trim();
  if (!k) return '';
  const upper = k.toUpperCase();
  if (upper === ADMIN_LICENSE_KEY || upper === 'ABLIT-DEV-UNLOCK' || upper === 'ABLIT-FREE') return upper;
  const m = k.match(/^ABLIT-(PRO|TEAM|STARTER)-([A-Za-z0-9]{4})-([A-Za-z0-9]{4})$/i);
  if (m) return `ABLIT-${m[1].toUpperCase()}-${m[2].toUpperCase()}-${m[3].toUpperCase()}`;
  return k;
}

export function verifyAdminLogin(username: string, password: string): boolean {
  const expected = adminCredentials();
  const user = username.trim().toLowerCase();
  const pass = password.trim();
  if (user === expected.username.trim().toLowerCase() && pass === expected.password) return true;
  const asKey = normalizeLicenseKey(pass || username);
  return asKey === ADMIN_LICENSE_KEY || asKey === 'ABLIT-DEV-UNLOCK';
}

export function isDevRuntime(): boolean {
  try {
    return Boolean(typeof import.meta !== 'undefined' && import.meta.env?.DEV);
  } catch {
    return false;
  }
}

/** Lightweight FNV-1a stub — mirrors “HMAC segment” shape for docs / future signing. */
export function stubHmacSegment(message: string): string {
  let h = 2166136261;
  const data = `${LICENSE_CLIENT_PEPPER}|${message}`;
  for (let i = 0; i < data.length; i++) {
    h ^= data.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hex = (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

/** Accepts ABLIT-PRO-XXXX-XXXX / ABLIT-TEAM-XXXX-XXXX / ABLIT-DEV-UNLOCK / ABLIT-ADMIN. */
export function isRecognizedLicenseFormat(key: string): boolean {
  const k = normalizeLicenseKey(key);
  if (!k) return false;
  if (k === 'ABLIT-DEV-UNLOCK' || k === ADMIN_LICENSE_KEY || k === 'ABLIT-FREE') return true;
  return /^ABLIT-(PRO|TEAM|STARTER)-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(k);
}

/**
 * Stub verifier: prefix → tier. Does **not** cryptographically validate XXXX segments.
 * Server-issued keys should HMAC-sign payload with a private key; clients check signature.
 */
export function resolveLicenseTier(key: string): LicenseTier {
  const k = normalizeLicenseKey(key);
  if (k === 'ABLIT-FREE') return 'free';
  if (k === ADMIN_LICENSE_KEY || k === 'ABLIT-DEV-UNLOCK') return 'admin';
  if (/^ABLIT-TEAM-/.test(k)) return 'team';
  if (/^ABLIT-PRO-/.test(k)) return 'pro';
  if (/^ABLIT-STARTER-/.test(k)) return 'starter';
  if (!k && isDevRuntime()) return 'admin';
  if (!k) return 'free';
  return 'free';
}

export function featuresForTier(tier: LicenseTier): LicenseFeatures {
  return { ...TIER_FEATURES[tier] };
}

export function getLicenseState(settings: { licenseKey?: string } | null | undefined): LicenseState {
  let key = normalizeLicenseKey(settings?.licenseKey ?? '');
  const tier = resolveLicenseTier(key);
  if (!key && tier === 'admin') key = ADMIN_LICENSE_KEY;
  const features = featuresForTier(tier);
  return {
    tier,
    features,
    label: TIER_LABEL[tier],
    key,
    isFree: tier === 'free',
  };
}

/** Clamp a desired Jobs concurrency against the license + hard cap (4). */
export function clampJobsByLicense(desired: unknown, license: LicenseState): number {
  const n = typeof desired === 'number' ? desired : Number(desired);
  const base = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
  const cap = license.features.maxConcurrentJobs;
  const licensed = Number.isFinite(cap) ? Math.min(base, cap) : base;
  const hard = license.tier === 'admin' ? 16 : 4;
  return Math.min(hard, Math.max(1, licensed));
}

/** Count servers marked enabled. */
export function countEnabledMcp(servers: { enabled?: boolean }[] | undefined): number {
  return (servers || []).filter((s) => s.enabled === true).length;
}

export const LICENSE_TEST_KEYS = {
  free: 'ABLIT-FREE',
  starter: 'ABLIT-STARTER-TEST-0001',
  pro: 'ABLIT-PRO-TEST-0001',
  team: 'ABLIT-TEAM-TEST-0001',
  dev: 'ABLIT-DEV-UNLOCK',
  admin: ADMIN_LICENSE_KEY,
} as const;

export const PRICING_HINT = {
  proMonthly: 29,
  proYearly: 249,
  teamMonthlySeat: 99,
} as const;
