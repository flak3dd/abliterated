/**
 * URL / hostname safety for agent `web_fetch` (SSRF guard).
 * Pure helpers — no network I/O.
 */

const BLOCKED_HOST_LABELS = new Set([
  'localhost',
  '0.0.0.0',
  '::1',
  '0:0:0:0:0:0:0:1',
  'metadata.google.internal',
  'metadata',
]);

function stripBrackets(host: string): string {
  return host.replace(/^\[|\]$/g, '').toLowerCase();
}

function parseIpv4(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map((x) => Number(x));
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts;
}

function isBlockedIpv4(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 0) return true;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedIpv6(host: string): boolean {
  if (!host.includes(':')) return false;
  if (host === '::' || host === '::1') return true;
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) {
    const parts = parseIpv4(mapped[1]);
    return !parts || isBlockedIpv4(parts);
  }
  if (/^f[cd][0-9a-f]{0,2}:/i.test(host) || /^fe[89ab][0-9a-f]?:/i.test(host)) return true;
  return false;
}

/** True when hostname must not be fetched by the agent (SSRF). */
export function isBlockedFetchHostname(hostname: string): boolean {
  const host = stripBrackets(hostname);
  if (!host) return true;
  if (BLOCKED_HOST_LABELS.has(host)) return true;
  if (host.endsWith('.localhost') || host.endsWith('.local')) return true;

  const v4 = parseIpv4(host);
  if (v4) return isBlockedIpv4(v4);
  if (isBlockedIpv6(host)) return true;
  return false;
}

export type SafeFetchUrlResult =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

/** Validate protocol + host for web_fetch. Does not perform DNS. */
export function assertSafeFetchUrl(raw: string): SafeFetchUrlResult {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid url' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'only http(s) urls are allowed' };
  }
  if (isBlockedFetchHostname(parsed.hostname)) {
    return { ok: false, reason: 'refused: local or private address' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'refused: url credentials' };
  }
  return { ok: true, url: parsed };
}
