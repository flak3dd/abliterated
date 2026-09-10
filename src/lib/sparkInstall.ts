import type { ClientSettings } from '../types';

export const UNCENSORED_IMAGE_MODEL = 'krea2-raw-fp8';
export const FAST_IMAGE_MODEL = 'krea2-turbo';
export const FAST_INT8_IMAGE_MODEL = 'krea2-turbo';
export const KLEIN_IMAGE_MODEL = 'flux2-klein-9b';
export const QWEN_IMAGE_MODEL = 'qwen-image-2512-fp8';
export const QWEN_EDIT_IMAGE_MODEL = 'qwen-edit-2511-fp8';
export const DRAFT_IMAGE_MODEL = 'z-image-turbo-nsfw-nvfp4';
export const ANIME_IMAGE_MODEL = 'illustrious-wai-nsfw';
export const PONY_IMAGE_MODEL = 'pony-v6';


/** Canonical Build D contract. Priority: Krea > Huihui TE > :8000 LLM > Klein/Edit/SeedVR2. */
export const BUILD_D = {
  build: "D" as const,
  heroDit: "krea2_raw_fp8_scaled.safetensors",
  heroModelId: UNCENSORED_IMAGE_MODEL,
  pipelineClass: "Krea2Pipeline",
  repo: "krea/Krea-2-Raw",
  uncensorLora: "krea2_uncensor.safetensors",
  loraStrength: 0.75,
  loraRange: [0.7, 1.0] as const,
  textEncoder: "Huihui-Qwen3-VL-4B-Instruct-abliterated-fp8_scaled.safetensors",
  textEncoderAlt: "Heretic Qwen3-VL-4B (KREA_TEXT_ENCODER_REPO)",
  textEncoderNote: "Load-time REPLACE stock Qwen3-VL-4B. TE alone != unlock; DiT + LoRA 0.75. Image TE != Prompt LLM :8000.",
  sampler: "euler",
  scheduler: "beta",
  steps: 24,
  cfg: 3.5,
  maxEdgeMin: 1328,
  maxEdgeMax: 1536,
  upscaleLater: "seedvr2-7b-fp8",
  secondPath: KLEIN_IMAGE_MODEL,
  instructionPath: QWEN_IMAGE_MODEL,
  editPath: QWEN_EDIT_IMAGE_MODEL,
  draftPath: DRAFT_IMAGE_MODEL,
  animeZoo: [ANIME_IMAGE_MODEL, PONY_IMAGE_MODEL] as const,
  runtime: "aarch64 / CUDA 13 / sm_121 / highvram-equivalent (unified 128 GB)",
  imagePort: 7860,
  textPort: 8000,
  promptLlm: "qwen-abliterated (THe-Plague Qwen3.6-35B-A3B NVFP4-MTP; alts Huihui/OrcaRouter 27B/35B-A3B)",
} as const;

export const SPARK_IMAGE_MODELS = [
  { id: UNCENSORED_IMAGE_MODEL, label: "Quality (Krea 2 RAW)" },
  { id: FAST_IMAGE_MODEL, label: "Fast (Krea 2 Turbo)" },
  { id: DRAFT_IMAGE_MODEL, label: "Draft (Z-Image Turbo)" },
  { id: QWEN_IMAGE_MODEL, label: "Instruction (Qwen-Image)" },
  { id: QWEN_EDIT_IMAGE_MODEL, label: "Edit / Inpaint (Qwen-Edit)" },
  { id: KLEIN_IMAGE_MODEL, label: "FLUX.2 Klein 9B" },
  { id: ANIME_IMAGE_MODEL, label: "Anime (Illustrious WAI)" },
  { id: PONY_IMAGE_MODEL, label: "Anime (Pony V6)" },
] as const;

const DRAFT_ALIASES = new Set([DRAFT_IMAGE_MODEL, 'z-image-turbo-6b', 'draft', 'sketch', 'z-image']);
const KLEIN_ALIASES = new Set([KLEIN_IMAGE_MODEL, 'klein-9b', 'flux-klein-9b', 'adherence', 'klein']);
const FAST_ALIASES = new Set([FAST_IMAGE_MODEL, 'fast', 'turbo', 'nvfp4', 'krea2-turbo-nvfp4']);
const QUALITY_ALIASES = new Set([UNCENSORED_IMAGE_MODEL, 'quality', 'hero', 'krea2', 'krea2-raw', 'krea', 'raw']);
const INSTRUCTION_ALIASES = new Set([QWEN_IMAGE_MODEL, 'qwen-image', 'instruction', 'type']);
const EDIT_ALIASES = new Set([
  QWEN_EDIT_IMAGE_MODEL, 'qwen-edit', 'edit', 'faceswap', 'face-swap', 'id-swap',
  'id', 'id_clean', 'id-clean', 'id_back', 'id-back', 'id_portrait', 'id-portrait',
]);

export function migrateSparkImageModel(stored?: string | null): string {
  const raw = (stored || '').trim();
  if (!raw || raw === 'flux2-klein-9b' || raw === 'flux2-klein-4b' || raw === 'krea2-turbo-nvfp4' || raw === 'krea2-turbo-int8' || raw === 'comfy-dreamshaper' || raw === 'quality' || raw === 'hero') {
    return UNCENSORED_IMAGE_MODEL;
  }
  return resolveSparkImageModel(raw);
}

export function resolveSparkImageModel(requested?: string): string {
  const name = (requested || '').trim().toLowerCase();
  if (DRAFT_ALIASES.has(name)) return DRAFT_IMAGE_MODEL;
  if (KLEIN_ALIASES.has(name)) return KLEIN_IMAGE_MODEL;
  if (FAST_ALIASES.has(name)) return FAST_IMAGE_MODEL;
  if (INSTRUCTION_ALIASES.has(name)) return QWEN_IMAGE_MODEL;
  if (EDIT_ALIASES.has(name)) return QWEN_EDIT_IMAGE_MODEL;
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

export const SPARK_CHAT_MODEL = 'qwen-abliterated';

export function sparkChatSettingsPatch(settings: Pick<ClientSettings, 'sparkLanHost'>): Partial<ClientSettings> {
  const loopback = sparkLanIsLoopback(settings);
  return { inferenceProvider: 'dgx-spark', sparkEnabled: true, remoteHostEnabled: true, sparkModel: SPARK_CHAT_MODEL, sparkBaseUrl: sparkChatUrl(settings), sparkViaProxy: loopback };
}

export function sparkQwenPushCommand(alias: string): string {
  return `bash spark-install/push.sh ${(alias || '').trim() || 'YOUR_SYNC_ALIAS'} --start --with-text`;
}

export function sparkPushCommand(alias: string): string {
  return `bash spark-install/push.sh ${(alias || '').trim() || 'YOUR_SYNC_ALIAS'} --start`;
}

export function sparkImageSettingsPatch(settings: Pick<ClientSettings, 'sparkLanHost'>, model: string = UNCENSORED_IMAGE_MODEL): Partial<ClientSettings> {
  const loopback = sparkLanIsLoopback(settings);
  const isElectron =
    typeof window !== 'undefined' && !!(window as Window & { ablitDesktop?: unknown }).ablitDesktop;
  // Electron talks raw :7860 / LAN; Vite proxy only helps browser DEV against loopback.
  return {
    imageGenEnabled: true,
    imageBackend: 'spark',
    imageBaseUrl: sparkImageUrl(settings),
    imageModel: resolveSparkImageModel(model),
    imageViaProxy: isElectron ? false : loopback,
  };
}

export const IMAGE_MODEL_OPTIONS = [
  ...SPARK_IMAGE_MODELS,
  { id: 'seedvr2-7b-fp8', label: 'Upscale (SeedVR2)' },
  { id: 'flux2-dev', label: 'Photoreal (FLUX.2 [dev])' },
] as const;

export function sparkBridgeDownHint(_settings?: Pick<ClientSettings, 'sparkLanHost' | 'sparkSshAlias'>): string {
  return 'Bridge down on :7860.';
}
export function sparkOpsCheatSheet(): { label: string; cmd: string }[] { return [{ label: 'Push + start', cmd: 'bash spark-install/push.sh YOUR_SYNC_ALIAS --start' }]; }

/** Hint for starting the image bridge on Spark (SSH / local install). */
export function sparkStartCommand(): string {
  return 'bash ~/abliterated-spark/spark-install/start.sh';
}

/** NVIDIA Sync tunnel + push start recipe for clipboard. */
export function sparkTunnelStartHint(alias?: string): string {
  const push = sparkPushCommand(alias || '');
  return [
    '# NVIDIA Sync: Custom app "Abliterated Images" (port 7860) — keeps tunnel alive',
    '# Or from Mac:',
    push,
    '# Or on Spark:',
    sparkStartCommand(),
  ].join('\n');
}
