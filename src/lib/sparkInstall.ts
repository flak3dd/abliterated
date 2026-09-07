import type { ClientSettings } from '../types';

/** Quality default: Krea 2 Turbo NVFP4 + uncensor LoRA. */
export const UNCENSORED_IMAGE_MODEL = 'krea2-turbo-nvfp4';
/** High-volume sketch model kept loaded on Spark. */
export const DRAFT_IMAGE_MODEL = 'z-image-turbo-nsfw-nvfp4';

const DRAFT_ALIASES = new Set([
  DRAFT_IMAGE_MODEL,
  'z-image-turbo-nvfp4',
  'z-image',
  'zimage',
  'draft',
  'sketch',
]);

export function resolveSparkImageModel(requested?: string): string {
  const name = (requested || '').trim().toLowerCase();
  if (DRAFT_ALIASES.has(name)) return DRAFT_IMAGE_MODEL;
  return UNCENSORED_IMAGE_MODEL;
}

export function sparkLanHost(settings: Pick<ClientSettings, 'sparkLanHost'>): string {
  const h = (settings.sparkLanHost || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return h || '127.0.0.1';
}

export function sparkLanIsLoopback(settings: Pick<ClientSettings, 'sparkLanHost'>): boolean {
  const h = sparkLanHost(settings);
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

export function sparkImageUrl(settings: Pick<ClientSettings, 'sparkLanHost'>): string {
  return `http://${sparkLanHost(settings)}:7860/v1`;
}

export function sparkChatUrl(settings: Pick<ClientSettings, 'sparkLanHost'>): string {
  return `http://${sparkLanHost(settings)}:8000/v1`;
}

export function sparkComfyUrl(settings: Pick<ClientSettings, 'sparkLanHost'>): string {
  return `http://${sparkLanHost(settings)}:8188`;
}

export function sparkPushCommand(alias: string): string {
  const a = (alias || '').trim() || 'YOUR_SYNC_ALIAS';
  return `bash spark-install/push.sh ${a} --start`;
}

export function sparkImageSettingsPatch(
  settings: Pick<ClientSettings, 'sparkLanHost'>,
  model: string = UNCENSORED_IMAGE_MODEL,
): Partial<ClientSettings> {
  const loopback = sparkLanIsLoopback(settings);
  return {
    imageGenEnabled: true,
    imageBaseUrl: sparkImageUrl(settings),
    imageModel: resolveSparkImageModel(model),
    imageViaProxy: loopback,
  };
}
