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
