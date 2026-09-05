import type { ClientSettings, InferenceProvider } from '../types';

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
};

export function resolveActiveSettings(settings: ClientSettings): ActiveEndpoint {
  const provider = settings.inferenceProvider ?? 'abliteration';

  if (provider === 'dgx-spark') {
    if (settings.sparkEnabled) {
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
      baseUrl: settings.baseUrl,
      token: settings.token,
      defaultModel: settings.defaultModel,
      label: 'spark',
      provider,
      active: false,
      sparkViaProxy: false,
      featherlessViaProxy: false,
    };
  }

  if (provider === 'featherless') {
    if (settings.featherlessEnabled !== false) {
      const model = settings.featherlessModel?.trim() || 'Qwen/Qwen2.5-7B-Instruct';
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
    return {
      baseUrl: settings.baseUrl,
      token: settings.token,
      defaultModel: settings.defaultModel,
      label: 'featherless',
      provider,
      active: false,
      sparkViaProxy: false,
      featherlessViaProxy: false,
    };
  }

  if (provider === 'custom') {
    return {
      baseUrl: settings.baseUrl,
      token: settings.token,
      defaultModel: settings.defaultModel,
      label: 'custom',
      provider,
      active: true,
      sparkViaProxy: false,
      featherlessViaProxy: false,
    };
  }

  return {
    baseUrl: settings.baseUrl,
    token: settings.token,
    defaultModel: settings.defaultModel,
    label: 'ablit',
    provider: 'abliteration',
    active: true,
    sparkViaProxy: false,
    featherlessViaProxy: false,
  };
}

export const INFERENCE_PROVIDERS: { id: InferenceProvider; label: string }[] = [
  { id: 'abliteration', label: 'Abliteration' },
  { id: 'dgx-spark', label: 'DGX Spark' },
  { id: 'featherless', label: 'Featherless' },
  { id: 'custom', label: 'Custom' },
];

/** Apply a provider switch with the flags needed so resolveActiveSettings is live. */
export function applyInferenceProvider(
  settings: ClientSettings,
  provider: InferenceProvider,
): ClientSettings {
  const patch: Partial<ClientSettings> =
    provider === 'featherless'
      ? { inferenceProvider: provider, featherlessEnabled: true, remoteHostEnabled: true }
      : provider === 'dgx-spark'
        ? { inferenceProvider: provider, sparkEnabled: true, remoteHostEnabled: true }
        : { inferenceProvider: provider, remoteHostEnabled: true };
  return { ...settings, ...patch };
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
