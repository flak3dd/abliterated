/**
 * Account auth client for abliterated.app signup / login APIs.
 * Passwords never leave the HTTPS request body; no secrets in this repo.
 */

import {
  BillingApiError,
  DEFAULT_BILLING_SITE,
  billingApiUrl,
  billingSiteBase,
  getOrCreateDeviceId,
  type BillingSiteSettings,
} from './billingApi';

export { DEFAULT_BILLING_SITE, billingApiUrl, billingSiteBase, getOrCreateDeviceId };

export class AuthApiError extends BillingApiError {
  constructor(message: string, status = 0, detail?: string) {
    super(message, status, detail);
    this.name = 'AuthApiError';
  }
}

export type AuthSiteSettings = BillingSiteSettings & {
  deviceId?: string;
};

export type SignupRequest = {
  email: string;
  password: string;
  deviceId: string;
};

export type SignupResponse = {
  loginId: string;
  email: string;
  deviceId: string;
  licenseKey?: string | null;
  tier?: string;
};

export type LoginEmailRequest = {
  email: string;
  password: string;
  deviceId: string;
};

export type LoginWithLoginIdRequest = {
  loginId: string;
  deviceId: string;
};

export type LoginResponse = {
  loginId: string;
  licenseKey?: string | null;
  tier?: string;
  email?: string;
  plan?: string;
  deviceId?: string;
};

type JsonRecord = Record<string, unknown>;

/** Offline helper: JSON body for POST /api/signup */
export function signupRequestBody(body: SignupRequest): SignupRequest {
  return {
    email: String(body.email || '').trim().toLowerCase(),
    password: String(body.password || ''),
    deviceId: String(body.deviceId || '').trim(),
  };
}

/** Offline helper: JSON body for email/password login */
export function loginEmailRequestBody(body: LoginEmailRequest): LoginEmailRequest {
  return {
    email: String(body.email || '').trim().toLowerCase(),
    password: String(body.password || ''),
    deviceId: String(body.deviceId || '').trim(),
  };
}

/** Offline helper: JSON body for loginId + device login */
export function loginWithLoginIdRequestBody(
  body: LoginWithLoginIdRequest,
): LoginWithLoginIdRequest {
  return {
    loginId: String(body.loginId || '').trim(),
    deviceId: String(body.deviceId || '').trim(),
  };
}

export function signupUrl(settingsOrUrl?: AuthSiteSettings | string | null): string {
  return billingApiUrl(settingsOrUrl, '/api/signup');
}

export function loginUrl(settingsOrUrl?: AuthSiteSettings | string | null): string {
  return billingApiUrl(settingsOrUrl, '/api/login');
}

async function readJson(res: Response): Promise<JsonRecord> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as JsonRecord;
  } catch {
    throw new AuthApiError('Invalid JSON from auth API', res.status, text.slice(0, 200));
  }
}

function friendlyUnavailable(status: number, fallback: string): string {
  if (status === 404) {
    return 'Auth API not available yet (404). Sign up / Log in may not be live on this site.';
  }
  if (status === 503) {
    return 'Auth service temporarily unavailable (503). Try again later.';
  }
  return fallback;
}

function errorFromBody(body: JsonRecord, fallback: string, status: number): AuthApiError {
  const base =
    typeof body.error === 'string' && body.error.trim()
      ? body.error.trim()
      : friendlyUnavailable(status, fallback);
  const detail = typeof body.detail === 'string' ? body.detail : undefined;
  const message =
    status === 404 || status === 503
      ? friendlyUnavailable(status, base)
      : detail
        ? `${base}: ${detail}`
        : base;
  return new AuthApiError(message, status, detail);
}

function parseLoginId(json: JsonRecord, status: number): string {
  const loginId = typeof json.loginId === 'string' ? json.loginId.trim() : '';
  if (!loginId) throw new AuthApiError('Auth response missing loginId', status);
  return loginId;
}

/**
 * Resolve a stable device id: settings → Electron userData → localStorage UUID.
 * Persists into settings via `persist` when a new id is minted or loaded from Electron.
 */
export async function ensureDeviceId(
  settings: AuthSiteSettings | null | undefined,
  persist?: (deviceId: string) => void,
): Promise<string> {
  const fromSettings = String(settings?.deviceId || '').trim();
  if (fromSettings) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('ablit_device_id', fromSettings);
      }
    } catch {
      /* ignore */
    }
    return fromSettings;
  }

  type DesktopBridge = { getDeviceId?: () => Promise<string> };
  const w =
    typeof globalThis !== 'undefined'
      ? (globalThis as { window?: Window & { ablitDesktop?: DesktopBridge } }).window
      : undefined;
  const desktop = w?.ablitDesktop;
  if (desktop?.getDeviceId) {
    try {
      const fromElectron = String((await desktop.getDeviceId()) || '').trim();
      if (fromElectron) {
        persist?.(fromElectron);
        try {
          localStorage.setItem('ablit_device_id', fromElectron);
        } catch {
          /* ignore */
        }
        return fromElectron;
      }
    } catch {
      /* fall through */
    }
  }

  const id = getOrCreateDeviceId();
  persist?.(id);
  return id;
}

export async function signup(
  settingsOrUrl: AuthSiteSettings | string | null | undefined,
  body: SignupRequest,
): Promise<SignupResponse> {
  const payload = signupRequestBody(body);
  if (!payload.email || !payload.email.includes('@')) {
    throw new AuthApiError('Valid email required', 400);
  }
  if (payload.password.length < 8) {
    throw new AuthApiError('Password must be at least 8 characters', 400);
  }
  if (!payload.deviceId || payload.deviceId.length < 8) {
    throw new AuthApiError('deviceId required (min 8 chars)', 400);
  }

  const url = signupUrl(settingsOrUrl);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AuthApiError(`Network error calling signup: ${msg}`, 0);
  }

  const json = await readJson(res);
  if (!res.ok) throw errorFromBody(json, 'Signup failed', res.status);

  const loginId = parseLoginId(json, res.status);
  const email = typeof json.email === 'string' ? json.email : payload.email;
  const deviceId =
    typeof json.deviceId === 'string' && json.deviceId.trim()
      ? json.deviceId.trim()
      : payload.deviceId;

  return {
    loginId,
    email,
    deviceId,
    licenseKey: typeof json.licenseKey === 'string' ? json.licenseKey : json.licenseKey === null ? null : undefined,
    tier: typeof json.tier === 'string' ? json.tier : undefined,
  };
}

export async function loginEmail(
  settingsOrUrl: AuthSiteSettings | string | null | undefined,
  body: LoginEmailRequest,
): Promise<LoginResponse> {
  const payload = loginEmailRequestBody(body);
  if (!payload.email || !payload.password || !payload.deviceId) {
    throw new AuthApiError('email, password, and deviceId required', 400);
  }

  const url = loginUrl(settingsOrUrl);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AuthApiError(`Network error calling login: ${msg}`, 0);
  }

  const json = await readJson(res);
  if (!res.ok) throw errorFromBody(json, 'Login failed', res.status);

  return {
    loginId: parseLoginId(json, res.status),
    licenseKey:
      typeof json.licenseKey === 'string'
        ? json.licenseKey
        : json.licenseKey === null
          ? null
          : undefined,
    tier: typeof json.tier === 'string' ? json.tier : undefined,
    email: typeof json.email === 'string' ? json.email : payload.email,
    plan: typeof json.plan === 'string' ? json.plan : undefined,
    deviceId:
      typeof json.deviceId === 'string' && json.deviceId.trim()
        ? json.deviceId.trim()
        : payload.deviceId,
  };
}

export async function loginWithLoginId(
  settingsOrUrl: AuthSiteSettings | string | null | undefined,
  body: LoginWithLoginIdRequest,
): Promise<LoginResponse> {
  const payload = loginWithLoginIdRequestBody(body);
  if (!payload.loginId || !payload.deviceId) {
    throw new AuthApiError('loginId and deviceId required', 400);
  }

  const url = loginUrl(settingsOrUrl);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AuthApiError(`Network error calling login: ${msg}`, 0);
  }

  const json = await readJson(res);
  if (!res.ok) throw errorFromBody(json, 'Login failed', res.status);

  return {
    loginId: parseLoginId(json, res.status),
    licenseKey:
      typeof json.licenseKey === 'string'
        ? json.licenseKey
        : json.licenseKey === null
          ? null
          : undefined,
    tier: typeof json.tier === 'string' ? json.tier : undefined,
    email: typeof json.email === 'string' ? json.email : undefined,
    plan: typeof json.plan === 'string' ? json.plan : undefined,
    deviceId:
      typeof json.deviceId === 'string' && json.deviceId.trim()
        ? json.deviceId.trim()
        : payload.deviceId,
  };
}
