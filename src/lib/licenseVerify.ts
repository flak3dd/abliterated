/** Online license check against abliterated.app. Prefix still works within a 7-day grace. */

import { billingApiUrl } from './billingApi';

function normalizeKey(key: string): string {
  return (key || '').trim().toUpperCase();
}

const CACHE_KEY = 'ablit_license_verify';
export const LICENSE_VERIFY_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export type LicenseVerifyCache = {
  key: string;
  ok: boolean;
  checkedAt: number;
  /** False when the last attempt was a network/404 (old site) — do not fail closed. */
  authoritative: boolean;
};

export function readLicenseVerifyCache(): LicenseVerifyCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as LicenseVerifyCache;
    if (!j || typeof j.key !== 'string') return null;
    return j;
  } catch {
    return null;
  }
}

export function writeLicenseVerifyCache(row: LicenseVerifyCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(row));
  } catch {
    /* quota */
  }
}

export function clearLicenseVerifyCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/** True when a paid prefix must drop to Free (authoritative reject past grace). */
export function licenseVerifyForcesFree(key: string): boolean {
  const k = normalizeKey(key);
  if (!k) return false;
  const cache = readLicenseVerifyCache();
  if (!cache || cache.key !== k) return false;
  if (cache.ok || !cache.authoritative) return false;
  return Date.now() - cache.checkedAt > LICENSE_VERIFY_GRACE_MS;
}

export async function refreshLicenseVerification(
  key: string,
  billingSiteUrl?: string,
): Promise<LicenseVerifyCache> {
  const k = normalizeKey(key);
  const row: LicenseVerifyCache = {
    key: k,
    ok: true,
    checkedAt: Date.now(),
    authoritative: false,
  };
  if (!k) {
    writeLicenseVerifyCache(row);
    return row;
  }
  try {
    const url = billingApiUrl(billingSiteUrl, '/api/license/verify');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: k }),
    });
    if (res.status === 404) {
      writeLicenseVerifyCache(row);
      return row;
    }
    if (!res.ok) {
      writeLicenseVerifyCache({ ...row, ok: true, authoritative: false });
      return row;
    }
    const json = (await res.json()) as { ok?: boolean };
    const ok = json.ok !== false;
    const next = { key: k, ok, checkedAt: Date.now(), authoritative: true };
    writeLicenseVerifyCache(next);
    return next;
  } catch {
    writeLicenseVerifyCache(row);
    return row;
  }
}
