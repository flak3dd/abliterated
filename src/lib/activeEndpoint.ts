import type { ClientSettings, InferenceProvider } from '../types';
import { resolveFeatherlessModelId } from './featherlessQwen.js';
import { sparkChatSettingsPatch } from './sparkInstall';

/** Resolve-time Abliteration cloud fallbacks only — not form defaults (Custom tab stays empty). */
const ABLITERATION_DEFAULT_BASE_URL =
  (import.meta.env.VITE_ABLITERATED_BASE_URL as string | undefined)?.trim() ||
  'https://api.abliteration.ai/v1';
const ABLITERATION_DEFAULT_MODEL =
  (import.meta.env.VITE_ABLITERATED_MODEL as string | undefined)?.trim() || 'abliterated-model';

/** DEV-only `.env.local` token. Production builds must not bake this into the SPA. */
function abliterationEnvToken(): string {
  if (!import.meta.env.DEV) return '';
  return String(import.meta.env.VITE_ABLITERATED_TOKEN || '').trim();
}

export function isLocalFeatherOAuthBase(baseUrl?: string): boolean {
  const u = (baseUrl || '').trim().replace(/\/$/, '');
  return u === 'http://127.0.0.1:3000/v1' || u === 'http://localhost:3000/v1';
}

export function isProviderConfigured(settings: ClientSettings, provider: InferenceProvider): boolean {
  if (provider === 'abliteration') return true;
  if (provider === 'dgx-spark') return settings.sparkEnabled !== false;
  if (provider === 'featherless') {
    return Boolean(settings.featherlessToken?.trim()) || isLocalFeatherOAuthBase(settings.featherlessBaseUrl);
  }
  if (provider === 'platform') {
    return Boolean(settings.token?.trim() || settings.accountLoggedIn);
  }
  if (provider === 'custom') {
    return Boolean(settings.baseUrl?.trim() && settings.defaultModel?.trim());
  }
  return true;
}

export function providerUnconfiguredReason(settings: ClientSettings, provider: InferenceProvider): string | null {
  if (provider === 'featherless') {
    if (!settings.featherlessToken?.trim() && !isLocalFeatherOAuthBase(settings.featherlessBaseUrl)) {
      return 'Featherless API key required';
    }
  }
  if (provider === 'platform') {
    if (!settings.token?.trim() && !settings.accountLoggedIn) {
      return 'Account login or platform key required';
    }
  }
  if (provider === 'custom') {
    if (!settings.baseUrl?.trim() || !settings.defaultModel?.trim()) {
      return 'Custom Base URL and model name required';
    }
  }
  return null;
}

export type ActiveEndpoint = {
  baseUrl: string;
  token: string;
  defaultModel: string;
  label: string;
  provider: InferenceProvider;
  /** False when provider is dgx-spark/featherless but endpoint is off (falls back to cloud fields). */
  active: boolean;
  sparkViaProxy: boolean;
  featherlessViaProxy: boolean;
  fallbackReason?: string;
};

export function resolveActiveSettings(settings: ClientSettings): ActiveEndpoint {
  const provider = settings.inferenceProvider ?? 'abliteration';
  const envTok = abliterationEnvToken();
  const ablitFallback: ActiveEndpoint = {
    baseUrl: settings.baseUrl?.trim() || ABLITERATION_DEFAULT_BASE_URL,
    token: envTok || (settings.token ?? '').trim(),
    defaultModel: settings.defaultModel?.trim() || ABLITERATION_DEFAULT_MODEL,
    label: 'ablit (safe fallback)',
    provider: 'abliteration',
    active: true,
    sparkViaProxy: false,
    featherlessViaProxy: false,
  };

  if (provider === 'dgx-spark') {
    if (settings.sparkEnabled !== false) {
      const model = settings.sparkModel?.trim() || 'qwen-abliterated';
      return {
        baseUrl: settings.sparkBaseUrl?.trim() || 'http://127.0.0.1:8000/v1',
        token: settings.sparkToken ?? '',
        defaultModel: model,
        label: 'spark:' + model,
        provider,
        active: true,
        sparkViaProxy: settings.sparkViaProxy !== false,
        featherlessViaProxy: false,
      };
    }
    return {
      ...ablitFallback,
      fallbackReason: 'DGX Spark is marked disabled. Safely routed via Abliteration Cloud Cluster so agent continues working.',
    };
  }

  if (provider === 'featherless') {
    if (settings.featherlessEnabled === false) {
      return {
        ...ablitFallback,
        fallbackReason: 'Featherless is marked disabled. Safely routed via Abliteration Cloud Cluster so agent continues working.',
      };
    }
    if (!settings.featherlessToken?.trim() && !isLocalFeatherOAuthBase(settings.featherlessBaseUrl)) {
      return {
        ...ablitFallback,
        fallbackReason: 'Featherless API key is missing. Safely routed via Abliteration Cloud Cluster so agent continues working.',
      };
    }
    const model = resolveFeatherlessModelId(settings.featherlessModel);
    return {
      baseUrl: settings.featherlessBaseUrl?.trim() || 'https://api.featherless.ai/v1',
      token: settings.featherlessToken ?? '',
      defaultModel: model,
      label: 'featherless:' + model,
      provider,
      active: true,
      sparkViaProxy: false,
      featherlessViaProxy: settings.featherlessViaProxy === true,
    };
  }

  if (provider === 'platform') {
    if (!settings.token?.trim() && !settings.accountLoggedIn) {
      return {
        ...ablitFallback,
        fallbackReason: 'Platform credentials missing. Safely routed via Abliteration Cloud Cluster so agent continues working.',
      };
    }
    const defaultBase =
      (import.meta.env.VITE_PLATFORM_GATEWAY_URL as string | undefined)?.trim() ||
      'https://abliterated.app/api/v1';
    return {
      baseUrl: settings.baseUrl?.trim() || defaultBase,
      token: settings.token ?? '',
      defaultModel: settings.defaultModel?.trim() || 'standard',
      label: 'platform:' + (settings.defaultModel?.trim() || 'standard'),
      provider,
      active: true,
      sparkViaProxy: false,
      featherlessViaProxy: false,
    };
  }

  if (provider === 'custom') {
    if (!settings.baseUrl?.trim() || !settings.defaultModel?.trim()) {
      return {
        ...ablitFallback,
        fallbackReason: 'Custom endpoint requires base URL and model. Safely routed via Abliteration Cloud Cluster so agent continues working.',
      };
    }
    return {
      baseUrl: settings.baseUrl.trim(),
      token: settings.token ?? '',
      defaultModel: settings.defaultModel.trim(),
      label: 'custom',
      provider,
      active: true,
      sparkViaProxy: false,
      featherlessViaProxy: false,
    };
  }

  // Abliteration
  return {
    baseUrl: settings.baseUrl?.trim() || ABLITERATION_DEFAULT_BASE_URL,
    token: envTok || (settings.token ?? '').trim(),
    defaultModel: settings.defaultModel?.trim() || ABLITERATION_DEFAULT_MODEL,
    label: 'ablit',
    provider: 'abliteration',
    active: true,
    sparkViaProxy: false,
    featherlessViaProxy: false,
  };
}

export const INFERENCE_PROVIDERS: { id: InferenceProvider; label: string }[] = [
  { id: 'platform', label: 'Platform' },
  { id: 'abliteration', label: 'Abliteration' },
  { id: 'dgx-spark', label: 'DGX Spark' },
  { id: 'featherless', label: 'Featherless (BYOK)' },
  { id: 'custom', label: 'Custom (BYOK)' },
];

/** Apply a provider switch with the flags needed so resolveActiveSettings is live. */
const DEFAULT_PLATFORM_GATEWAY =
  (import.meta.env.VITE_PLATFORM_GATEWAY_URL as string | undefined)?.trim() ||
  'https://abliterated.app/api/v1';

export function applyInferenceProvider(
  settings: ClientSettings,
  provider: InferenceProvider,
): ClientSettings {
  if (provider === 'featherless') {
    return {
      ...settings,
      inferenceProvider: provider,
      featherlessEnabled: true,
      remoteHostEnabled: true,
    };
  }
  if (provider === 'dgx-spark') {
    return {
      ...settings,
      ...sparkChatSettingsPatch(settings),
    };
  }
  if (provider === 'platform') {
    const prev = settings.baseUrl?.trim() || '';
    const keep =
      prev &&
      !prev.includes('api.abliteration.ai') &&
      !prev.includes('api.featherless.ai');
    return {
      ...settings,
      inferenceProvider: provider,
      remoteHostEnabled: true,
      baseUrl: keep ? prev : DEFAULT_PLATFORM_GATEWAY,
      defaultModel: settings.defaultModel?.trim() || 'standard',
    };
  }
  return { ...settings, inferenceProvider: provider, remoteHostEnabled: true };
}

export function providerShortLabel(settings: ClientSettings): string {
  return resolveActiveSettings(settings).label;
}

function endpointHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Local Settings admin login is not an inference API key. */
export function missingInferenceAuthError(active: ActiveEndpoint): string | null {
  if (active.token.trim()) return null;
  const host = endpointHost(active.baseUrl);
  if (active.provider === 'featherless' || host === 'api.featherless.ai') {
    return (
      'Featherless requires a cloud API key. Local admin login (Settings) only unlocks the IDE license — it does not sign you into Featherless. ' +
      'Open API → Featherless and paste a key, or switch the provider to Abliteration.'
    );
  }
  if (active.provider === 'platform') {
    return (
      'Platform gateway key is missing. Sign in / activate a license, then use API → Platform → Connect with account ' +
      '(exchanges login for a virtual key). Local admin login alone is not enough.'
    );
  }
  if (active.provider === 'abliteration' || host === 'api.abliteration.ai') {
    return (
      'Abliteration API key is missing. Local admin login is not an API token. ' +
      'Paste the key on API → Token, or set VITE_ABLITERATED_TOKEN in .env.local and restart Vite.'
    );
  }
  if (active.provider === 'custom' && /^https?:/.test(active.baseUrl) && !/127\.0\.0\.1|localhost/i.test(host)) {
    return `No token set for ${active.label}. Add it on the API tab. Local admin login does not authenticate remote APIs.`;
  }
  return null;
}

export function rejectedInferenceAuthError(active: ActiveEndpoint, body: string): string {
  const signedIn = /must be signed in|unauthorized/i.test(body);
  if (active.provider === 'featherless' || endpointHost(active.baseUrl) === 'api.featherless.ai' || signedIn) {
    return (
      ' Featherless rejected auth. Local admin login does not count. ' +
      'Paste a Featherless API key on the API tab, or switch provider to Abliteration.'
    );
  }
  if (!active.token.trim()) {
    return ' No API token was sent. Local admin login is not an inference key — add one on the API tab.';
  }
  return ` Auth/token rejected by ${active.label}. Check the API tab token.`;
}
