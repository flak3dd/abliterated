import type { ClientSettings } from '../types';

/** Quality default: Krea 2 RAW FP8 Build D + uncensor LoRA @ 0.75. */
export const UNCENSORED_IMAGE_MODEL = 'krea2-raw-fp8';
export const KLEIN_IMAGE_MODEL = 'flux2-klein-9b';
export const FAST_IMAGE_MODEL = 'krea2-turbo-nvfp4';
export const FAST_INT8_IMAGE_MODEL = 'krea2-turbo-int8';
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

const KLEIN_ALIASES = new Set([
  KLEIN_IMAGE_MODEL,
  'klein',
  'klein-9b',
  'flux2-klein',
  'flux-klein-9b',
  'adherence',
]);

const FAST_ALIASES = new Set([
  FAST_IMAGE_MODEL,
  FAST_INT8_IMAGE_MODEL,
  'fast',
  'turbo',
  'nvfp4',
  'int8',
  'krea2-turbo',
  'krea-2-turbo',
]);

const QUALITY_ALIASES = new Set([
  UNCENSORED_IMAGE_MODEL,
  'quality',
  'krea2',
  'krea2-raw',
  'raw',
  'hero',
  'abliterated-flux-klein',
  'comfy-dreamshaper',
  'comfy-abliterated-flux',
]);

export function resolveSparkImageModel(requested?: string): string {
  const name = (requested || '').trim().toLowerCase();
  if (DRAFT_ALIASES.has(name)) return DRAFT_IMAGE_MODEL;
  if (KLEIN_ALIASES.has(name)) return KLEIN_IMAGE_MODEL;
  if (FAST_ALIASES.has(name)) {
    if (name === FAST_INT8_IMAGE_MODEL || name === 'int8') return FAST_INT8_IMAGE_MODEL;
    return FAST_IMAGE_MODEL;
  }
  if (!name || QUALITY_ALIASES.has(name)) return UNCENSORED_IMAGE_MODEL;
  return name;
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

export const IMAGE_MODEL_OPTIONS = [
  { id: UNCENSORED_IMAGE_MODEL, label: 'Quality - Krea 2 RAW FP8 (Build D)' },
  { id: KLEIN_IMAGE_MODEL, label: 'Klein - FLUX.2 Klein 9B (adherence)' },
  { id: FAST_IMAGE_MODEL, label: 'Fast - Krea 2 Turbo NVFP4' },
  { id: DRAFT_IMAGE_MODEL, label: 'Draft - Z-Image Turbo NVFP4' },
] as const;

/** Shown in Images/API empty states when the bridge is down. */
export function sparkBridgeDownHint(
  settings?: Pick<ClientSettings, 'sparkLanHost' | 'sparkSshAlias'>,
): string {
  const host = settings ? sparkLanHost(settings) : '127.0.0.1';
  const alias = (settings?.sparkSshAlias || '').trim() || 'YOUR_SYNC_ALIAS';
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (loopback) {
    return [
      'Bridge down on :7860.',
      'Mock (no GPU): npm run image:mock',
      'On Spark: cd ~/abliterated-spark/spark-install && ./start.sh && ./status.sh',
      'From Mac: bash spark-install/push.sh ' + alias + ' --start',
    ].join(String.fromCharCode(10));
  }
  return [
    'Bridge down at http://' + host + ':7860.',
    'On Spark: ./status.sh ' + host + '  then  ./start.sh',
    'From Mac: bash spark-install/push.sh ' + alias + ' --start',
    'Images: Via proxy OFF when using a LAN Spark IP.',
  ].join(String.fromCharCode(10));
}

export function sparkOpsCheatSheet(): { label: string; cmd: string }[] {
  return [
    { label: 'Push + start', cmd: 'bash spark-install/push.sh YOUR_SYNC_ALIAS --start' },
    { label: 'Install', cmd: 'cd ~/abliterated-spark/spark-install && ./install.sh --start' },
    { label: 'Start', cmd: './start.sh' },
    { label: 'Status', cmd: './status.sh' },
    { label: 'Stop', cmd: './stop.sh' },
  ];
}
