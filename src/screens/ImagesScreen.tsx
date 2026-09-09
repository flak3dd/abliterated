import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Columns2,
  Copy,
  Download,
  Eye,
  FolderOpen,
  History,
  ImageIcon,
  ImagePlus,
  Loader2,
  Maximize2,
  Square,
  Trash2,
  Upload,
  UserRound,
  CreditCard,
  X,
} from 'lucide-react';
import { useToast } from '../components/common/Toast';
import { bridge } from '../lib/bridgeClient';
import { cn } from '../lib/cn';
import { compactFileToDataUrl, friendlyImageError, generateImage, generateTestImage, imageEndpointUrl, isBridgeOfflineError, pingImageEndpoint, type ImageGenResult } from '../lib/imageGen';
import {
  XAI_IMAGE_MODEL,
  XAI_QUALITIES,
  XAI_RESOLUTIONS,
  isXaiImageBackend,
  resolveXaiImageModel,
  xaiImageSettingsPatch,
} from '../lib/xaiImage';
import {
  IMAGE_LIBRARY_MAX,
  deleteLibraryImage,
  formatImageElapsed,
  getLibraryImageDataUrl,
  imageProgressSoftStatus,
  listLibraryImages,
  saveGeneratedImage,
  type StoredImageMeta,
} from '../lib/imageLibrary';
import {
  composeIdPrompt,
  ID_MIN_EDGE_PX,
  ID_TEMPLATES,
  ID_TYPES,
  idContentRatio,
  idIntent,
  lowRes,
  probeImageSize,
  type IdDocType,
  type IdKind,
  type IdLook,
} from '../lib/idPipeline';
import {
  IMAGE_RATIOS,
  LONG_EDGES,
  nearestLongEdge,
  nearestRatioId,
  parseSize,
  sizeForRatio,
  type LongEdge,
  type RatioId,
} from '../lib/imageAspect';
import {
  ANIME_IMAGE_MODEL,
  BUILD_D,
  DRAFT_IMAGE_MODEL,
  FAST_IMAGE_MODEL,
  IMAGE_MODEL_OPTIONS,
  KLEIN_IMAGE_MODEL,
  PONY_IMAGE_MODEL,
  QWEN_EDIT_IMAGE_MODEL,
  QWEN_IMAGE_MODEL,
  UNCENSORED_IMAGE_MODEL,
  resolveSparkImageModel,
  sparkChatSettingsPatch,
  sparkImageSettingsPatch,
  sparkImageUrl,
  sparkLanHost,
  sparkPushCommand,
  sparkStartCommand,
  sparkTunnelStartHint,
} from '../lib/sparkInstall';
import { setSettings } from '../lib/storage';
import type { ClientSettings } from '../types';

interface Props {
  settings: ClientSettings;
  onSettingsChange: (s: ClientSettings) => void;
}

const BATCH_NS = [1, 2, 3, 4] as const;
const PROMPT_HISTORY_KEY = 'ablit_image_prompt_history';
const PROMPT_HISTORY_MAX = 20;
const MODEL_CUSTOM = '__custom__';

/** Job chips only select a mode. The primary button is what actually generates. */
const IMAGE_JOBS = {
  quality: {
    chip: 'New still',
    title: 'New still — quality',
    intent: 'Creates a new photoreal image from the prompt. Does not edit a photo you drop in.',
    action: 'Generate quality still',
  },
  fast: {
    chip: 'Fast still',
    title: 'New still — fast',
    intent: 'Creates a new image quickly (Krea Turbo). Lower fidelity than quality.',
    action: 'Generate fast still',
  },
  draft: {
    chip: 'Draft sketch',
    title: 'New still — draft',
    intent: 'Creates a quick NSFW-capable sketch (Z-Image Turbo). For layout, not finals.',
    action: 'Generate draft sketch',
  },
  instruction: {
    chip: 'From text',
    title: 'New still — instruction',
    intent: 'Creates a new image from a written instruction (Qwen-Image). No reference photo.',
    action: 'Generate from text',
  },
  edit: {
    chip: 'Edit photo',
    title: 'Edit an existing photo',
    intent: 'Changes the dropped photo using your instruction. Requires a reference image.',
    action: 'Apply edit to photo',
  },
  faceswap: {
    chip: 'Face onto photo',
    title: 'Put this face on a photo',
    intent: 'Copies the identity face onto the target scene. Needs both images. Prompt is optional.',
    action: 'Put face on photo',
  },
  id: {
    chip: 'ID document',
    title: 'ID document',
    intent: 'Works on a real scan: clean or swap the portrait. Does not invent a new identity.',
    action: 'Run ID pipeline',
  },
  klein: {
    chip: 'Klein still',
    title: 'New still — Klein 9B',
    intent: 'Creates a new image with FLUX.2 Klein. Gated weights; no-op if missing.',
    action: 'Generate Klein still',
  },
  anime: {
    chip: 'Anime still',
    title: 'New still — anime',
    intent: 'Creates a new illustration (Illustrious / Pony zoo). Not the photoreal quality path.',
    action: 'Generate anime still',
  },
} as const;

type ImageJobId = keyof typeof IMAGE_JOBS;

const PROMPT_SUGGESTIONS = [
  'Futuristic dark cybernetic terminal with neon blue accents',
  'Minimalist geometric architectural rendering with ambient lighting',
  'Retro vector illustration of a developer workbench in space',
];

function formatWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function hostFromBaseUrl(base: string): string {
  try {
    const u = new URL((base || 'http://127.0.0.1:7860/v1').trim());
    return u.host || u.hostname || '—';
  } catch {
    return (base || '').replace(/^https?:\/\//, '').split('/')[0] || '—';
  }
}

function loadPromptHistory(): string[] {
  try {
    const raw = localStorage.getItem(PROMPT_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, PROMPT_HISTORY_MAX);
  } catch {
    return [];
  }
}

function savePromptHistory(items: string[]) {
  try {
    localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(items.slice(0, PROMPT_HISTORY_MAX)));
  } catch {
    /* quota */
  }
}

function pushPromptHistory(prompt: string): string[] {
  const p = prompt.trim();
  if (!p) return loadPromptHistory();
  const next = [p, ...loadPromptHistory().filter((x) => x !== p)].slice(0, PROMPT_HISTORY_MAX);
  savePromptHistory(next);
  return next;
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

function isElectronDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.ablitDesktop;
}

function stripDataUrlBase64(dataUrl: string): string {
  const s = (dataUrl || '').trim();
  if (s.startsWith('data:') && s.includes(',')) return s.slice(s.indexOf(',') + 1);
  return s;
}

function chipOn(on: boolean, opts?: { muted?: boolean }) {
  return cn(
    'chip',
    opts?.muted && 'opacity-40 cursor-not-allowed hover:border-zinc-700 hover:text-zinc-500',
    on && !opts?.muted && 'border-emerald-700/80 bg-emerald-950/50 text-emerald-300 hover:border-emerald-600 hover:text-emerald-200',
  );
}

function ImageDropSlot({
  label,
  preview,
  dragOver,
  emptyHint,
  onPick,
  onClear,
  onUsePreview,
  fileRef,
  setDragOver,
}: {
  label: string;
  preview: string | null;
  dragOver: boolean;
  emptyHint: string;
  onPick: (file: File | null | undefined) => void;
  onClear: () => void;
  onUsePreview?: () => void;
  fileRef: { current: HTMLInputElement | null };
  setDragOver: (v: boolean) => void;
}) {
  return (
    <div>
      <div className="mb-1 font-mono text-[10px] uppercase text-muted">{label}</div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
      <div
        role="button"
        tabIndex={0}
        className={cn(
          'flex min-h-[7rem] cursor-pointer flex-col items-center justify-center gap-2 rounded border border-dashed px-3 py-3 text-center transition-colors',
          dragOver ? 'border-sky-500/70 bg-sky-950/30' : 'border-border bg-background/40',
          preview ? 'border-emerald-700/50' : '',
        )}
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void onPick(e.dataTransfer.files?.[0]);
        }}
      >
        {preview ? (
          <div className="flex w-full flex-col items-center gap-2">
            <img src={preview} alt="" className="max-h-36 rounded object-contain" />
            <div className="flex flex-wrap justify-center gap-1.5">
              <button
                type="button"
                className="chip text-[9px]"
                onClick={(e) => {
                  e.stopPropagation();
                  fileRef.current?.click();
                }}
              >
                <Upload size={10} /> Replace
              </button>
              <button
                type="button"
                className="chip text-[9px] text-red-300/90"
                onClick={(e) => {
                  e.stopPropagation();
                  onClear();
                }}
              >
                Clear
              </button>
            </div>
          </div>
        ) : (
          <>
            <ImagePlus size={18} className="text-zinc-500" />
            <span className="font-mono text-[10px] text-zinc-400">{emptyHint}</span>
            {onUsePreview ? (
              <button
                type="button"
                className="chip text-[9px]"
                onClick={(e) => {
                  e.stopPropagation();
                  onUsePreview();
                }}
              >
                Use current preview
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export function ImagesScreen({ settings, onSettingsChange }: Props) {
  const toast = useToast();
  const [prompt, setPrompt] = useState('');
  const [ratioId, setRatioId] = useState<RatioId>('1:1');
  const [longEdge, setLongEdge] = useState<LongEdge>(1024);
  const [batchN, setBatchN] = useState<(typeof BATCH_NS)[number]>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorOpen, setErrorOpen] = useState(false);
  const [b64, setB64] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [testNote, setTestNote] = useState('');
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [healthChecking, setHealthChecking] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[] | null>(null);
  const [testDetailOpen, setTestDetailOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; prompt: string } | null>(null);
  const [comparePair, setComparePair] = useState<{ left: { src: string; prompt: string }; right: { src: string; prompt: string } } | null>(null);

  const [progress, setProgress] = useState<number | null>(null);
  const [progressEst, setProgressEst] = useState(true);
  const [progressFailed, setProgressFailed] = useState(false);
  const [progressElapsedMs, setProgressElapsedMs] = useState(0);
  const [progressServerStatus, setProgressServerStatus] = useState<string>('');

  const [library, setLibrary] = useState<StoredImageMeta[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryNote, setLibraryNote] = useState('');
  const [libQuery, setLibQuery] = useState('');
  const [filterModel, setFilterModel] = useState<string | null>(null);
  const [filterSize, setFilterSize] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [promptHistory, setPromptHistory] = useState<string[]>(() => loadPromptHistory());
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyCursorRef = useRef(-1);
  const [endpointOpen, setEndpointOpen] = useState(true);
  const [endpointUserToggled, setEndpointUserToggled] = useState(false);
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [refImagePreview, setRefImagePreview] = useState<string | null>(null);
  const [refImageB64, setRefImageB64] = useState<string | null>(null);
  const [refDragOver, setRefDragOver] = useState(false);
  const refFileInputRef = useRef<HTMLInputElement | null>(null);
  const [editKind, setEditKind] = useState<'edit' | 'faceswap' | 'id'>('edit');
  const [idDocType, setIdDocType] = useState<IdDocType>('drivers_license');
  const [idCountry, setIdCountry] = useState('');
  const [idLook, setIdLook] = useState<IdLook>('capture');
  const [idTemplateId, setIdTemplateId] = useState<string | null>(null);
  const [backImagePreview, setBackImagePreview] = useState<string | null>(null);
  const [backImageB64, setBackImageB64] = useState<string | null>(null);
  const [backDragOver, setBackDragOver] = useState(false);
  const backFileInputRef = useRef<HTMLInputElement | null>(null);
  const [idImagePreview, setIdImagePreview] = useState<string | null>(null);
  const [idImageB64, setIdImageB64] = useState<string | null>(null);
  const [idDragOver, setIdDragOver] = useState(false);
  const idFileInputRef = useRef<HTMLInputElement | null>(null);

  const thumbCache = useRef<Record<string, string>>({});
  const progressEstRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const modelSelectRef = useRef<HTMLSelectElement | null>(null);
  const generateCardRef = useRef<HTMLDivElement | null>(null);
  const healthAbortRef = useRef<AbortController | null>(null);

  const knownModelIds = useMemo(() => IMAGE_MODEL_OPTIONS.map((m) => m.id as string), []);
  const modelSelectValue = knownModelIds.includes(settings.imageModel) ? settings.imageModel : MODEL_CUSTOM;
  const showCustomModel = modelSelectValue === MODEL_CUSTOM;

  const patch = (partial: Partial<ClientSettings>) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    onSettingsChange(next);
  };

  const previewSrc = useMemo(() => {
    if (b64) return `data:image/png;base64,${b64}`;
    if (remoteUrl) return remoteUrl;
    return null;
  }, [b64, remoteUrl]);

  const refreshLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const entries = await listLibraryImages();
      setLibrary(entries);
      const nextThumbs: Record<string, string> = { ...thumbCache.current };
      await Promise.all(
        entries.slice(0, 36).map(async (e) => {
          if (nextThumbs[e.id]) return;
          const url = await getLibraryImageDataUrl(e);
          if (url) nextThumbs[e.id] = url;
        }),
      );
      thumbCache.current = nextThumbs;
      setThumbUrls({ ...nextThumbs });
      setLibraryNote('');
    } catch (err) {
      setLibraryNote(err instanceof Error ? err.message : String(err));
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  const softHealthCheck = useCallback(
    async (s: ClientSettings = settings) => {
      if (!s.imageGenEnabled) return;
      healthAbortRef.current?.abort();
      const ac = new AbortController();
      healthAbortRef.current = ac;
      setHealthChecking(true);
      const timeout = window.setTimeout(() => ac.abort(), 4000);
      try {
        const result = await pingImageEndpoint({ ...s, imageGenEnabled: true }, ac.signal);
        if (ac.signal.aborted) return;
        setTestOk(result.ok);
        setTestNote(result.note);
        if (result.availableModels) setAvailableModels(result.availableModels);
        else if (result.ok) setAvailableModels(null);
        if (!result.ok) {
          setTestDetailOpen(false);
          setAvailableModels([]);
        }
        if (!endpointUserToggled) setEndpointOpen(!result.ok);
      } catch {
        if (ac.signal.aborted) return;
        setTestOk(false);
        setTestNote('health check failed');
        if (!endpointUserToggled) setEndpointOpen(true);
      } finally {
        window.clearTimeout(timeout);
        if (healthAbortRef.current === ac) {
          setHealthChecking(false);
          healthAbortRef.current = null;
        }
      }
    },
    [settings, endpointUserToggled],
  );

  useEffect(() => {
    if (!settings.imageGenEnabled) return;
    void softHealthCheck(settings);
    return () => {
      healthAbortRef.current?.abort();
    };
  }, [
    settings.imageGenEnabled,
    settings.imageBackend,
    settings.imageBaseUrl,
    settings.imageViaProxy,
    settings.imageToken,
    settings.xaiImageBaseUrl,
    settings.xaiImageToken,
  ]);

  // Electron: prefer Via proxy off (Vite /image-v1 is a DEV-browser concern and causes 502s with Sync/tunnel).
  useEffect(() => {
    if (!isElectronDesktop()) return;
    if (settings.imageViaProxy !== true) return;
    const next = { ...settings, imageViaProxy: false };
    setSettings(next);
    onSettingsChange(next);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — migrate once on mount

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (comparePair) {
          setComparePair(null);
          e.preventDefault();
          return;
        }
        if (lightboxImage) {
          setLightboxImage(null);
          e.preventDefault();
        }
        return;
      }
      if (e.key === 'g' || e.key === 'G') {
        const t = e.target as HTMLElement | null;
        const tag = t?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable) return;
        if (!settings.imageGenEnabled) return;
        e.preventDefault();
        promptRef.current?.focus();
        generateCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxImage, comparePair, settings.imageGenEnabled]);

  const persistResult = async (
    result: { b64?: string; url?: string },
    p: string,
    sz: string,
    model?: string,
  ) => {
    if (!result.b64 && !result.url) return;
    try {
      await saveGeneratedImage({
        prompt: p,
        size: sz,
        model:
          model ||
          (isXaiImageBackend(settings)
            ? resolveXaiImageModel(settings.xaiImageModel)
            : settings.imageModel || UNCENSORED_IMAGE_MODEL),
        b64: result.b64,
        url: result.url,
      });
      await refreshLibrary();
      toast.success('Saved to library');
    } catch (err) {
      console.warn('saveGeneratedImage failed', err);
      const msg = err instanceof Error ? err.message : String(err);
      setLibraryNote(msg);
      toast.error('Save failed', msg);
    }
  };

  const cancelGenerate = () => {
    abortRef.current?.abort();
  };

  const clearRefImage = () => {
    setRefImagePreview(null);
    setRefImageB64(null);
  };

  const clearIdImage = () => {
    setIdImagePreview(null);
    setIdImageB64(null);
  };

  const loadImageFile = async (
    file: File | null | undefined,
    setPreview: (s: string | null) => void,
    setB64: (s: string | null) => void,
  ) => {
    if (!file || !file.type.startsWith('image/')) {
      toast.warning('Pick an image file');
      return;
    }
    try {
      const dataUrl = await compactFileToDataUrl(file);
      setPreview(dataUrl);
      setB64(stripDataUrlBase64(dataUrl) || null);
    } catch (err) {
      toast.error('Could not read image', err instanceof Error ? err.message : String(err));
    }
  };

  const loadRefFile = (file: File | null | undefined) => loadImageFile(file, setRefImagePreview, setRefImageB64);
  const loadIdFile = (file: File | null | undefined) => loadImageFile(file, setIdImagePreview, setIdImageB64);
  const loadBackFile = (file: File | null | undefined) => loadImageFile(file, setBackImagePreview, setBackImageB64);
  const clearBackImage = () => {
    setBackImagePreview(null);
    setBackImageB64(null);
  };

  const usePreviewAsTarget = () => {
    if (!previewSrc) {
      toast.warning('No preview yet');
      return;
    }
    setRefImagePreview(previewSrc);
    setRefImageB64(stripDataUrlBase64(previewSrc) || null);
  };

  const generate = async (job?: {
    prompt?: string;
    intent?: string;
    imageB64?: string | null;
    idImageB64?: string | null;
    idType?: string;
    country?: string;
    idLook?: string;
    ratioId?: RatioId;
    allowEmptyPrompt?: boolean;
  }): Promise<ImageGenResult | null> => {
    const p = (job?.prompt ?? prompt).trim();
    if (busyRef.current) return null;
    const resolvedForGate = resolveSparkImageModel(settings.imageModel);
    const jobIntent = (job?.intent || '').trim();
    const isIdJob = jobIntent.startsWith('id_');
    const editNeedsRef = resolvedForGate === QWEN_EDIT_IMAGE_MODEL && editKind !== 'faceswap' && !isIdJob;
    const faceswapNeeds = resolvedForGate === QWEN_EDIT_IMAGE_MODEL && editKind === 'faceswap' && !isIdJob;
    const targetB64 = job?.imageB64 !== undefined ? job.imageB64 : refImageB64;
    const identB64 = job?.idImageB64 !== undefined ? job.idImageB64 : idImageB64;
    if (editNeedsRef && !targetB64) {
      toast.warning('Edit needs a reference image', 'Drop or choose an image above Generate');
      return null;
    }
    if (faceswapNeeds && (!targetB64 || !identB64)) {
      toast.warning('ID swap needs both images', 'Identity face + target scene');
      return null;
    }
    if (!p && !faceswapNeeds && !job?.allowEmptyPrompt) return null;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    busyRef.current = true;

    setBusy(true);
    setError('');
    setErrorOpen(false);
    setB64(null);
    setRemoteUrl(null);
    setProgress(null);
    setProgressEst(true);
    progressEstRef.current = true;
    setProgressFailed(false);
    setProgressElapsedMs(0);
    setProgressServerStatus('');
    if (p) setPromptHistory(pushPromptHistory(p));
    historyCursorRef.current = -1;

    let sourceDim: { width: number; height: number } | null = null;
    const effectiveRatio = job?.ratioId || ratioId;
    if (effectiveRatio === 'auto') {
      const src = jobIntent === 'id_back' ? backImagePreview : refImagePreview || idImagePreview;
      if (src) {
        try {
          sourceDim = await probeImageSize(src);
        } catch {
          sourceDim = null;
        }
      }
      if (isIdJob) {
        const iso = idContentRatio(job?.idType || idDocType, sourceDim?.width ?? 0, sourceDim?.height ?? 0);
        sourceDim = { width: iso.w, height: iso.h };
      }
    }
    const outSize = sizeForRatio(effectiveRatio, longEdge, sourceDim);

    const started = Date.now();
    const tick = window.setInterval(() => {
      setProgressElapsedMs(Date.now() - started);
    }, 250);

    try {
      const xai = isXaiImageBackend(settings);
      const resolvedModel = resolveSparkImageModel(settings.imageModel);
      const isQuality = resolvedModel === UNCENSORED_IMAGE_MODEL;
      const isEdit = resolvedModel === QWEN_EDIT_IMAGE_MODEL;
      const isDraftOrFast =
        resolvedModel === DRAFT_IMAGE_MODEL || resolvedModel === FAST_IMAGE_MODEL;
      const genExtras = xai
        ? jobIntent
          ? { intent: jobIntent }
          : isEdit && editKind === 'faceswap'
            ? { intent: 'faceswap' as const }
            : isEdit
              ? { intent: 'edit' as const }
              : { intent: 'generate' as const }
        : isQuality
          ? {
              steps: BUILD_D.steps,
              guidance: BUILD_D.cfg,
              loraStrength: BUILD_D.loraStrength,
              intent: 'generate' as const,
            }
          : jobIntent
            ? { intent: jobIntent }
            : isEdit && editKind === 'faceswap'
              ? { intent: 'faceswap' as const }
              : isEdit
                ? { intent: 'edit' as const }
                : isDraftOrFast || resolvedModel === QWEN_IMAGE_MODEL
                  ? { intent: 'generate' as const }
                  : {};
      const requestPrompt = isIdJob
        ? p
        : p || (isEdit && editKind === 'faceswap' ? 'ID faceswap' : p);
      const persistPrompt = isIdJob
        ? composeIdPrompt({
            kind: jobIntent === 'id_clean' ? 'clean' : jobIntent === 'id_back' ? 'back' : 'portrait',
            userPrompt: p,
            idType: job?.idType || idDocType,
            country: job?.country || idCountry,
            look: job?.idLook || idLook,
          })
        : requestPrompt;
      const result = await generateImage({
        settings,
        prompt: requestPrompt,
        size: outSize,
        n: isIdJob ? 1 : batchN,
        model: xai ? resolveXaiImageModel(settings.xaiImageModel) : resolvedModel,
        ...genExtras,
        ...((isEdit || isIdJob) && targetB64 ? { imageB64: targetB64 } : {}),
        ...((isEdit && editKind === 'faceswap' && identB64) || (jobIntent === 'id_portrait' && identB64)
          ? { idImageB64: identB64 || undefined }
          : {}),
        ...(job?.idType ? { idType: job.idType } : isIdJob ? { idType: idDocType } : {}),
        ...(job?.country ? { country: job.country } : isIdJob && idCountry ? { country: idCountry } : {}),
        ...(isIdJob ? { idLook: job?.idLook || idLook } : {}),
        abortSignal: ac.signal,
        onProgress: (pct, estimated, info) => {
          if (info?.status) setProgressServerStatus(info.status);
          if (estimated) {
            // Soft waiting only — never drive a fake determinate %.
            return;
          }
          progressEstRef.current = false;
          setProgress((prev) => Math.max(prev ?? 0, pct));
          setProgressEst(false);
        },
      });
      setB64(result.b64 || null);
      setRemoteUrl(result.url || null);
      setProgress(100);
      setProgressEst(false);
      const all = result.images?.length ? result.images : [{ b64: result.b64, url: result.url }];
      if (!result.b64 && !result.url) {
        setError('Empty image payload');
        setErrorOpen(true);
        setProgressFailed(true);
        return null;
      }
      for (const img of all) {
        await persistResult(
          img,
          persistPrompt,
          outSize,
          xai ? resolveXaiImageModel(settings.xaiImageModel) : resolvedModel,
        );
      }
      return result;
    } catch (err) {
      if (isAbortError(err)) {
        setError('Cancelled');
        setErrorOpen(false);
        setProgressFailed(true);
        toast.info('Generation stopped');
      } else {
        const { friendly, detail } = friendlyImageError(err);
        setError(detail);
        setErrorOpen(isBridgeOfflineError(detail) ? false : true);
        setProgressFailed(true);
        toast.error(friendly.split('.')[0] || 'Generation failed', isBridgeOfflineError(detail) ? 'See status card above' : friendly);
        if (isBridgeOfflineError(detail) && !endpointUserToggled) setEndpointOpen(true);
      }
      return null;
    } finally {
      window.clearInterval(tick);
      busyRef.current = false;
      setBusy(false);
      if (abortRef.current === ac) abortRef.current = null;
      window.setTimeout(() => {
        setProgress(null);
        setProgressFailed(false);
        setProgressElapsedMs(0);
        setProgressServerStatus('');
      }, 700);
    }
  };

  const download = (src?: string | null, name = 'abliterated.png') => {
    const href = src === undefined ? previewSrc : src;
    if (!href) return;
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.click();
  };

  const openLibraryEntry = async (entry: StoredImageMeta) => {
    let src = thumbUrls[entry.id] || thumbCache.current[entry.id];
    if (!src) {
      src = (await getLibraryImageDataUrl(entry)) || '';
      if (src) {
        thumbCache.current[entry.id] = src;
        setThumbUrls((t) => ({ ...t, [entry.id]: src! }));
      }
    }
    if (!src) return;
    if (src.startsWith('data:image/png;base64,')) {
      setB64(src.slice('data:image/png;base64,'.length));
      setRemoteUrl(null);
    } else {
      setB64(null);
      setRemoteUrl(src);
    }
    setPrompt(entry.prompt);
  };

  const useFromLibrary = (entry: StoredImageMeta) => {
    setPrompt(entry.prompt || '');
    const dim = parseSize(entry.size || '1024x1024');
    setLongEdge(nearestLongEdge(Math.max(dim.width, dim.height)));
    setRatioId(nearestRatioId(dim.width, dim.height));
    if (entry.model?.trim()) patch({ imageModel: entry.model.trim() });
    generateCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    window.setTimeout(() => promptRef.current?.focus(), 50);
    toast.info('Loaded into Generate');
  };

  const removeLibraryEntry = async (entry: StoredImageMeta) => {
    try {
      await deleteLibraryImage(entry);
      delete thumbCache.current[entry.id];
      setThumbUrls((t) => {
        const next = { ...t };
        delete next[entry.id];
        return next;
      });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
      await refreshLibrary();
      toast.success('Deleted');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLibraryNote(msg);
      toast.error('Delete failed', msg);
    }
  };

  const testEndpoint = async () => {
    setTestNote('');
    setTestOk(null);
    setTestDetailOpen(false);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setHealthChecking(true);
    const timeout = window.setTimeout(() => ac.abort(), 4000);
    try {
      const result = await pingImageEndpoint({ ...settings, imageGenEnabled: true }, ac.signal);
      if (ac.signal.aborted) return;
      setTestOk(result.ok);
      setTestNote(result.note);
      if (result.availableModels) setAvailableModels(result.availableModels);
      else if (result.ok) setAvailableModels(null);
      if (result.ok) {
        toast.success('Image bridge reachable', result.note);
        if (!endpointUserToggled) setEndpointOpen(false);
      } else {
        setAvailableModels([]);
        toast.error('Bridge unreachable', 'Start tunnel / Use LAN / Open Endpoint');
        if (!endpointUserToggled) setEndpointOpen(true);
      }
    } catch (err) {
      if (isAbortError(err) || ac.signal.aborted) {
        setTestNote('Cancelled');
        setTestOk(null);
      } else {
        const { friendly, detail } = friendlyImageError(err);
        setTestNote(detail);
        setTestOk(false);
        toast.error(friendly.split('.')[0] || 'Bridge unreachable', 'See the status card above');
        if (!endpointUserToggled) setEndpointOpen(true);
      }
    } finally {
      window.clearTimeout(timeout);
      setHealthChecking(false);
      if (abortRef.current === ac) abortRef.current = null;
    }
  };

  const openBridge = () => {
    const url = sparkImageUrl(settings).replace(/\/v1$/, '');
    void (async () => {
      try {
        const opened = await window.ablitDesktop?.openExternal?.(url);
        if (opened) return;
      } catch {
        /* fall through */
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    })();
  };

  const modelAvailable = (model: string) => {
    // xAI Imagine is interchangeable with Spark for txt2img + edit/ID/swap; Spark weight probes do not apply.
    if (isXaiImageBackend(settings)) {
      return model === UNCENSORED_IMAGE_MODEL || model === QWEN_EDIT_IMAGE_MODEL;
    }
    // Quality hero assumed available when bridge is up unless probe explicitly excludes it.
    if (availableModels == null) return model === UNCENSORED_IMAGE_MODEL;
    return availableModels.includes(model);
  };
  const selectPathOrToast = (model: string, label: string, apply: () => void) => {
    if (!modelAvailable(model)) {
      toast.info(`${label} unavailable`, 'Weights not on Spark — chip disabled until pull');
      return;
    }
    apply();
  };

  const applyImageModel = (model: string) => {
    // Keep the active backend. Switching Quality/Edit must not bounce xAI → Spark.
    if (isXaiImageBackend(settings) || !(settings.sparkLanHost || '').trim()) {
      patch({ imageModel: resolveSparkImageModel(model) });
      return;
    }
    patch(sparkImageSettingsPatch(settings, model));
  };

  const applyQuality = () => {
    setEditKind('edit');
    if (isXaiImageBackend(settings)) {
      setLongEdge(settings.xaiImageResolution === '1k' ? 1024 : 1920);
      setRatioId('1:1');
      applyImageModel(UNCENSORED_IMAGE_MODEL);
      toast.success('xAI Imagine', `${settings.xaiImageModel || XAI_IMAGE_MODEL} · ${settings.xaiImageResolution || '2k'}`);
      return;
    }
    setLongEdge(1328);
    setRatioId('1:1');
    applyImageModel(UNCENSORED_IMAGE_MODEL);
    toast.success(
      'Quality — Build D hero',
      `${BUILD_D.steps} steps / CFG ${BUILD_D.cfg} / LoRA ${BUILD_D.loraStrength} · 1328×1328`,
    );
  };

  const applyFast = () => {
    selectPathOrToast(FAST_IMAGE_MODEL, 'Fast', () => {
      applyImageModel(FAST_IMAGE_MODEL);
      toast.info('Fast — Krea 2 Turbo', FAST_IMAGE_MODEL);
    });
  };

  const applyDraft = () => {
    selectPathOrToast(DRAFT_IMAGE_MODEL, 'Draft', () => {
      applyImageModel(DRAFT_IMAGE_MODEL);
      toast.info('Draft — Z-Image Turbo NSFW', DRAFT_IMAGE_MODEL);
    });
  };

  const applyInstruction = () => {
    selectPathOrToast(QWEN_IMAGE_MODEL, 'Instruction', () => {
      applyImageModel(QWEN_IMAGE_MODEL);
      toast.info('Instruction — Qwen-Image', QWEN_IMAGE_MODEL);
    });
  };

  const applyEdit = () => {
    selectPathOrToast(QWEN_EDIT_IMAGE_MODEL, 'Edit', () => {
      applyImageModel(QWEN_EDIT_IMAGE_MODEL);
      setEditKind('edit');
      setRatioId('auto');
      toast.info(
        isXaiImageBackend(settings) ? 'Edit — xAI Imagine' : 'Edit — Qwen-Edit',
        isXaiImageBackend(settings) ? 'Reference image required. Same drop slot as Spark.' : QWEN_EDIT_IMAGE_MODEL,
      );
    });
  };

  const applyFaceswap = () => {
    selectPathOrToast(QWEN_EDIT_IMAGE_MODEL, 'ID swap', () => {
      applyImageModel(QWEN_EDIT_IMAGE_MODEL);
      setEditKind('faceswap');
      setRatioId('auto');
      toast.info(
        isXaiImageBackend(settings) ? 'ID faceswap — xAI Imagine' : 'ID faceswap — Qwen-Edit multi-ref',
        'Identity face + target. Prompt optional.',
      );
    });
  };

  const applyIdSection = () => {
    selectPathOrToast(QWEN_EDIT_IMAGE_MODEL, 'ID', () => {
      applyImageModel(QWEN_EDIT_IMAGE_MODEL);
      setEditKind('id');
      setRatioId('auto');
      setIdTemplateId(null);
      toast.info(
        isXaiImageBackend(settings) ? 'ID document — xAI Imagine' : 'ID document — Qwen-Edit',
        'Front / back / headshot. Clean or swap portrait. No synthetic identity.',
      );
    });
  };

  const applyIdTemplate = (template: (typeof ID_TEMPLATES)[number]) => {
    applyIdSection();
    setIdDocType(template.idType);
    setIdCountry(template.country);
    setIdLook(template.look);
    setIdTemplateId(template.id);
    setPrompt(template.prompt);
    setRatioId(template.ratioId);
    toast.info(template.label, template.hint);
  };

  const runIdKind = async (
    kind: IdKind,
    imageOverride?: string | null,
    opts?: { prompt?: string; idType?: IdDocType; country?: string; idLook?: IdLook },
  ) => {
    const overrideSrc = imageOverride
      ? `data:image/png;base64,${imageOverride}`
      : null;
    const src = kind === 'back' ? backImagePreview : overrideSrc || refImagePreview;
    if (!src) {
      toast.warning(kind === 'back' ? 'Add a back scan' : 'Add a front scan');
      return null;
    }
    try {
      const dim = await probeImageSize(src);
      if (lowRes(dim.width, dim.height)) {
        toast.error('LOW_RES_INPUT', `Min edge ${Math.min(dim.width, dim.height)}px < ${ID_MIN_EDGE_PX}px`);
        return null;
      }
    } catch (err) {
      toast.error('Could not read document size', err instanceof Error ? err.message : String(err));
      return null;
    }
    if (kind === 'portrait' && !idImageB64) {
      toast.warning('Portrait swap needs a headshot');
      return null;
    }
    return generate({
      prompt: opts?.prompt ?? prompt,
      intent: idIntent(kind),
      imageB64: kind === 'back' ? backImageB64 : imageOverride || refImageB64,
      idImageB64: kind === 'portrait' ? idImageB64 : null,
      idType: opts?.idType ?? idDocType,
      country: opts?.country ?? idCountry,
      idLook: opts?.idLook ?? idLook,
      allowEmptyPrompt: true,
    });
  };

  const runIdAlteration = async () => {
    const template = ID_TEMPLATES.find((t) => t.id === 'alter_img2img');
    if (!template) return null;
    applyIdTemplate(template);
    return runIdKind('clean', undefined, {
      prompt: template.prompt,
      idType: template.idType,
      country: template.country,
      idLook: template.look,
    });
  };

  const runIdLicenceSelfie = async () => {
    const template = ID_TEMPLATES.find((t) => t.id === 'au_licence_selfie');
    if (!template) return null;
    applyIdTemplate(template);
    if (!refImagePreview || !refImageB64) {
      toast.warning('Add a front scan');
      return null;
    }
    try {
      const dim = await probeImageSize(refImagePreview);
      if (lowRes(dim.width, dim.height)) {
        toast.error('LOW_RES_INPUT', `Min edge ${Math.min(dim.width, dim.height)}px < ${ID_MIN_EDGE_PX}px`);
        return null;
      }
    } catch (err) {
      toast.error('Could not read document size', err instanceof Error ? err.message : String(err));
      return null;
    }
    return generate({
      prompt: template.prompt,
      intent: 'edit',
      imageB64: refImageB64,
      ratioId: template.ratioId,
      allowEmptyPrompt: true,
    });
  };

  const runIdPipeline = async () => {
    if (!refImageB64) {
      toast.warning('Add a front scan');
      return;
    }
    const cleaned = await runIdKind('clean');
    if (idImageB64) await runIdKind('portrait', cleaned?.b64 || undefined);
    if (backImageB64) await runIdKind('back');
  };

  const onPromptKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (editKind === 'id') void runIdPipeline();
      else void generate();
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const el = e.currentTarget;
      const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
      const emptyish = !prompt.trim() || (atStart && prompt.length < 4);
      if (!atStart && !emptyish) return;
      if (!promptHistory.length) return;
      e.preventDefault();
      {
        const prev = historyCursorRef.current;
        let next = prev;
        if (e.key === 'ArrowUp') {
          next = prev < 0 ? 0 : Math.min(promptHistory.length - 1, prev + 1);
        } else {
          next = prev <= 0 ? -1 : prev - 1;
        }
        historyCursorRef.current = next;
        if (next < 0) setPrompt('');
        else setPrompt(promptHistory[next] || '');
      }
    }
  };

  const applyKlein = () => {
    selectPathOrToast(KLEIN_IMAGE_MODEL, 'Klein', () => {
      applyImageModel(KLEIN_IMAGE_MODEL);
      toast.info('Klein 9B', KLEIN_IMAGE_MODEL);
    });
  };

  const applyAnime = () => {
    const animeOk = modelAvailable(ANIME_IMAGE_MODEL) || modelAvailable(PONY_IMAGE_MODEL);
    if (!animeOk) {
      toast.info('Anime unavailable', 'Zoo weights not on Spark — chip disabled until pull');
      return;
    }
    applyImageModel(modelAvailable(ANIME_IMAGE_MODEL) ? ANIME_IMAGE_MODEL : PONY_IMAGE_MODEL);
    toast.info('Anime — Illustrious WAI-NSFW', `${ANIME_IMAGE_MODEL} (Pony: ${PONY_IMAGE_MODEL})`);
    window.setTimeout(() => modelSelectRef.current?.focus(), 50);
  };

  const applySparkLan = () => {
    const p = {
      ...sparkImageSettingsPatch(settings, UNCENSORED_IMAGE_MODEL),
      ...sparkChatSettingsPatch(settings),
    };
    patch(p);
    toast.success('Spark LAN image + Qwen chat', sparkLanHost(settings));
    window.setTimeout(() => void softHealthCheck({ ...settings, ...p }), 50);
  };

  const copySparkInstall = async () => {
    const cmd = sparkPushCommand(settings.sparkSshAlias);
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedInstall(true);
      toast.success('Copied Spark install command');
      window.setTimeout(() => setCopiedInstall(false), 2000);
    } catch {
      toast.error('Clipboard failed', cmd);
    }
  };

  const copyStartCommand = async () => {
    const cmd = sparkTunnelStartHint(settings.sparkSshAlias);
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedInstall(true);
      toast.success('Copied start command', sparkStartCommand());
      window.setTimeout(() => setCopiedInstall(false), 2000);
    } catch {
      toast.error('Clipboard failed', cmd);
    }
  };

  const startTunnelAction = async () => {
    const cmd = sparkPushCommand(settings.sparkSshAlias);
    try {
      await navigator.clipboard.writeText(cmd);
      toast.success('Start tunnel', 'Copied Sync/push command — or open Abliterated Images in NVIDIA Sync');
    } catch {
      toast.info('Start tunnel', 'NVIDIA Sync → Custom app Abliterated Images (port 7860)');
    }
  };

  const openEndpointSection = () => {
    setEndpointUserToggled(true);
    setEndpointOpen(true);
    toast.info('Endpoint', 'URL / token / via-proxy below');
  };

  const revealOnDisk = async (entry: StoredImageMeta) => {
    if (entry.storage !== 'disk') {
      toast.info('IndexedDB only — nothing on disk');
      return;
    }
    if (!bridge.connected) {
      toast.warning('Bridge disconnected');
      return;
    }
    const root = bridge.validWorkspaceRoot || bridge.currentRoot;
    if (!root) {
      toast.warning('No workspace root to reveal');
      return;
    }
    const abs = `${root.replace(/\/$/, '')}/${entry.file.replace(/^\//, '')}`;
    try {
      const code = await bridge.runCommand(`open -R ${JSON.stringify(abs)}`);
      if (code === 0) toast.success('Revealed in Finder');
      else toast.warning('Reveal command exited', `code ${code}`);
    } catch (err) {
      toast.error('Reveal failed', err instanceof Error ? err.message : String(err));
    }
  };

  const filteredLibrary = useMemo(() => {
    const q = libQuery.trim().toLowerCase();
    return library.filter((e) => {
      if (q && !(e.prompt || '').toLowerCase().includes(q)) return false;
      if (filterModel && e.model !== filterModel) return false;
      if (filterSize && e.size !== filterSize) return false;
      return true;
    });
  }, [library, libQuery, filterModel, filterSize]);

  const libraryModels = useMemo(() => {
    const s = new Set<string>();
    for (const e of library) if (e.model) s.add(e.model);
    return [...s].sort();
  }, [library]);

  const librarySizes = useMemo(() => {
    const s = new Set<string>();
    for (const e of library) if (e.size) s.add(e.size);
    return [...s].sort();
  }, [library]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const bulkDelete = async () => {
    const entries = library.filter((e) => selectedIds.has(e.id));
    if (!entries.length) return;
    for (const e of entries) {
      try {
        await deleteLibraryImage(e);
        delete thumbCache.current[e.id];
      } catch {
        /* continue */
      }
    }
    setThumbUrls({ ...thumbCache.current });
    clearSelection();
    await refreshLibrary();
    toast.success(`Deleted ${entries.length}`);
  };

  const bulkDownload = async () => {
    const entries = library.filter((e) => selectedIds.has(e.id));
    if (!entries.length) return;
    toast.info(`Downloading ${entries.length}…`);
    for (const e of entries) {
      let src = thumbUrls[e.id] || thumbCache.current[e.id];
      if (!src) src = (await getLibraryImageDataUrl(e)) || '';
      if (src) download(src, `${e.id}.png`);
      await new Promise((r) => window.setTimeout(r, 120));
    }
  };

  const startCompare = async () => {
    const ids = [...selectedIds];
    if (ids.length !== 2) {
      toast.warning('Select exactly 2 images to compare');
      return;
    }
    const pair = ids.map((id) => library.find((e) => e.id === id)).filter(Boolean) as StoredImageMeta[];
    const a = pair[0];
    const b = pair[1];
    if (!a || !b) return;
    const load = async (e: StoredImageMeta) => {
      let src = thumbUrls[e.id] || thumbCache.current[e.id];
      if (!src) {
        src = (await getLibraryImageDataUrl(e)) || '';
        if (src) {
          thumbCache.current[e.id] = src;
          setThumbUrls((t) => ({ ...t, [e.id]: src! }));
        }
      }
      return src;
    };
    const leftSrc = await load(a);
    const rightSrc = await load(b);
    if (!leftSrc || !rightSrc) {
      toast.error('Could not load both images');
      return;
    }
    setComparePair({
      left: { src: leftSrc, prompt: a.prompt },
      right: { src: rightSrc, prompt: b.prompt },
    });
  };

  const xaiOn = isXaiImageBackend(settings);
  const xaiKeyOn = Boolean((settings.xaiImageToken || '').trim());
  const imageHost = hostFromBaseUrl(xaiOn ? settings.xaiImageBaseUrl : settings.imageBaseUrl);
  const softStatus = imageProgressSoftStatus(imageHost);
  const elapsedLabel = formatImageElapsed(progressElapsedMs);
  const serverStatusLabel =
    progressServerStatus === 'loading'
      ? 'Loading model…'
      : progressServerStatus === 'encoding'
        ? 'Encoding…'
        : progressServerStatus === 'waiting'
          ? softStatus
          : progressServerStatus === 'running'
            ? softStatus
            : progressServerStatus === 'done'
              ? 'Done'
              : progressServerStatus === 'error'
                ? 'Error'
                : softStatus;
  const progressIndeterminate = busy && (progressEst || progress == null) && !progressFailed;
  const progressLabel =
    progressFailed
      ? busy
        ? 'Stopping…'
        : 'Failed'
      : progress != null && progress >= 100
        ? `100% · ${elapsedLabel}`
        : progress != null && !progressEst
          ? `${progress}% · ${serverStatusLabel} · ${elapsedLabel}`
          : busy
            ? `${serverStatusLabel} · ${elapsedLabel}`
            : null;

  const healthPill =
    healthChecking || (testOk === null && settings.imageGenEnabled) ? (
      <span className="status-badge status-badge--busy">checking</span>
    ) : testOk === true ? (
      <span className="status-badge status-badge--ok">ok</span>
    ) : testOk === false ? (
      <button type="button" className="status-badge status-badge--err" onClick={() => setTestDetailOpen((o) => !o)}>
        unreachable
      </button>
    ) : null;

  const resolvedImageModel = resolveSparkImageModel(settings.imageModel);
  const isQualityPath = resolvedImageModel === UNCENSORED_IMAGE_MODEL;
  const isEditPath = resolvedImageModel === QWEN_EDIT_IMAGE_MODEL;
  const isFaceswapPath = isEditPath && editKind === 'faceswap';
  const isIdPath = isEditPath && editKind === 'id';
  const imageJobId: ImageJobId = isIdPath
    ? 'id'
    : isFaceswapPath
      ? 'faceswap'
      : isEditPath
        ? 'edit'
        : resolvedImageModel === FAST_IMAGE_MODEL
          ? 'fast'
          : resolvedImageModel === DRAFT_IMAGE_MODEL
            ? 'draft'
            : resolvedImageModel === QWEN_IMAGE_MODEL
              ? 'instruction'
              : resolvedImageModel === KLEIN_IMAGE_MODEL
                ? 'klein'
                : resolvedImageModel === ANIME_IMAGE_MODEL || resolvedImageModel === PONY_IMAGE_MODEL
                  ? 'anime'
                  : 'quality';
  const imageJob = IMAGE_JOBS[imageJobId];
  const isStubPath =
    resolvedImageModel === DRAFT_IMAGE_MODEL ||
    resolvedImageModel === FAST_IMAGE_MODEL ||
    resolvedImageModel === QWEN_IMAGE_MODEL ||
    resolvedImageModel === QWEN_EDIT_IMAGE_MODEL ||
    resolvedImageModel === KLEIN_IMAGE_MODEL ||
    resolvedImageModel === ANIME_IMAGE_MODEL ||
    resolvedImageModel === PONY_IMAGE_MODEL;
  const activeModelLabel =
    IMAGE_MODEL_OPTIONS.find((m) => m.id === resolvedImageModel)?.label ||
    settings.imageModel ||
    resolvedImageModel;
  const proxyOnUpstreamDown =
    !xaiOn && settings.imageViaProxy === true && testOk === false && !healthChecking;
  const bridgeOffline = !xaiOn && settings.imageGenEnabled && testOk === false && !healthChecking;
  const xaiKeyMissing = xaiOn && settings.imageGenEnabled && !xaiKeyOn;
  const xaiUnreachable = xaiOn && settings.imageGenEnabled && xaiKeyOn && testOk === false && !healthChecking;

    const endpointSummary = `${(xaiOn ? settings.xaiImageModel : settings.imageModel) || '—'} · ${imageHost} · ${
    healthChecking ? 'checking' : testOk === true ? 'ok' : testOk === false ? 'unreachable' : '—'
  }`;
  if (!settings.imageGenEnabled) {
    return (
      <div className="h-full overflow-auto p-4">
        <header className="page-header">
          <div className="flex items-center gap-2 page-header-title">
            <ImageIcon size={14} /> Images
          </div>
          <p className="page-header-sub">Spark local bridge or optional xAI Grok Imagine.</p>
        </header>

        <div className="section-card max-w-xl">
          <div className="section-card-title text-amber-300">Image generation disabled</div>
          <p className="section-card-hint mt-2">
            Pair the IDE with Spark image gen: quality{' '}
            <code className="text-zinc-400">{UNCENSORED_IMAGE_MODEL}</code> (Krea 2 RAW FP8 Build D — 24/3.5/LoRA 0.75) or draft{" "}
            <code className="text-zinc-400">{DRAFT_IMAGE_MODEL}</code> (Z-Image Turbo NSFW sketches). Cloud chat has vision <em>input</em>{" "}
            only — no hosted <code className="text-zinc-400">/v1/images/generations</code>.
          </p>
          <div className="section-card-body">
            <button type="button" onClick={() => patch({ imageGenEnabled: true })} className="btn-primary w-fit">
              Enable image generator
            </button>
            <button type="button" onClick={() => void copySparkInstall()} className="btn-ghost w-fit">
              <Copy size={11} /> {copiedInstall ? 'Copied!' : 'Copy Spark install command'}
            </button>
            <p className="font-mono text-[11px] text-muted">
              No GPU? Try <code className="text-zinc-300">npm run image:mock</code> for a local stub on :7860.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4">
      <header className="page-header">
        <div className="flex flex-wrap items-center gap-2 page-header-title">
          <ImageIcon size={14} /> Images
          {healthPill}
        </div>
        <p className="page-header-sub">
          Pick a job, then run it with the green button. Cmd/Ctrl+Enter runs the same action · Esc closes zoom · G focuses prompt
        </p>
      </header>

      {bridgeOffline ? (
        <div className="mb-3 max-w-3xl rounded border border-amber-700/50 bg-amber-950/30 px-3 py-2.5">
          <div className="font-mono text-[12px] font-medium text-amber-200">Spark image bridge offline</div>
          <p className="mt-1 font-mono text-[10px] leading-4 text-zinc-400">
            Nothing answering on the image endpoint. Start the Sync tunnel, point at Spark LAN, switch to xAI Imagine, or open Endpoint settings.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" className="btn-primary h-7 px-2 text-[10px]" onClick={() => void startTunnelAction()}>
              Start tunnel
            </button>
            <button type="button" className="btn-ghost h-7 px-2 text-[10px]" onClick={applySparkLan}>
              Use LAN
            </button>
            <button
              type="button"
              className="btn-ghost h-7 px-2 text-[10px]"
              onClick={() => patch(xaiImageSettingsPatch(settings))}
            >
              Use xAI Imagine
            </button>
            <button type="button" className="btn-ghost h-7 px-2 text-[10px]" onClick={openEndpointSection}>
              Open Endpoint
            </button>
            <button type="button" className="btn-ghost h-7 px-2 text-[10px]" onClick={() => void copyStartCommand()}>
              <Copy size={10} /> {copiedInstall ? 'Copied!' : 'Copy start command'}
            </button>
          </div>
        </div>
      ) : null}

      {xaiKeyMissing ? (
        <div className="mb-3 max-w-3xl rounded border border-amber-700/50 bg-amber-950/30 px-3 py-2.5">
          <div className="font-mono text-[12px] font-medium text-amber-200">xAI API key missing</div>
          <p className="mt-1 font-mono text-[10px] leading-4 text-zinc-400">
            Paste a key from console.x.ai on Endpoint. Spark URL/token stay saved — switch back anytime.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" className="btn-primary h-7 px-2 text-[10px]" onClick={openEndpointSection}>
              Open Endpoint
            </button>
            <button
              type="button"
              className="btn-ghost h-7 px-2 text-[10px]"
              onClick={() => patch({ imageBackend: 'spark', imageGenEnabled: true })}
            >
              Use Spark (local)
            </button>
          </div>
        </div>
      ) : null}

      {xaiUnreachable ? (
        <div className="mb-3 max-w-3xl rounded border border-amber-700/50 bg-amber-950/30 px-3 py-2.5">
          <div className="font-mono text-[12px] font-medium text-amber-200">xAI Imagine unreachable</div>
          <p className="mt-1 font-mono text-[10px] leading-4 text-zinc-400">{testNote || 'No response from api.x.ai. Check the key or switch back to Spark.'}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" className="btn-ghost h-7 px-2 text-[10px]" onClick={() => void testEndpoint()}>
              Test
            </button>
            <button
              type="button"
              className="btn-ghost h-7 px-2 text-[10px]"
              onClick={() => patch({ imageBackend: 'spark', imageGenEnabled: true })}
            >
              Use Spark (local)
            </button>
          </div>
        </div>
      ) : null}

      {proxyOnUpstreamDown ? (
        <p className="mb-2 max-w-3xl font-mono text-[10px] text-amber-300/90">
          Via proxy is on but the upstream is down — turn Via proxy off (Endpoint) or start the bridge; Electron prefers raw :7860.
        </p>
      ) : null}

      <div className="mb-1.5">
        <div className="mb-1 flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[10px] uppercase text-muted">Job</span>
          <span className="font-mono text-[10px] normal-case text-zinc-500">selects what the green button will do — does not generate</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={chipOn(imageJobId === 'quality')} onClick={applyQuality} title={IMAGE_JOBS.quality.intent} aria-label={`${IMAGE_JOBS.quality.chip}. ${IMAGE_JOBS.quality.intent}`}>
          {IMAGE_JOBS.quality.chip}
        </button>
        {!xaiOn ? (
          <>
        <button type="button" className={chipOn(imageJobId === 'fast', { muted: !modelAvailable(FAST_IMAGE_MODEL) })} onClick={applyFast} title={modelAvailable(FAST_IMAGE_MODEL) ? IMAGE_JOBS.fast.intent : `${FAST_IMAGE_MODEL} (weights missing)`} aria-disabled={!modelAvailable(FAST_IMAGE_MODEL)} aria-label={IMAGE_JOBS.fast.intent}>
          {IMAGE_JOBS.fast.chip}
        </button>
        <button type="button" className={chipOn(imageJobId === 'draft', { muted: !modelAvailable(DRAFT_IMAGE_MODEL) })} onClick={applyDraft} title={modelAvailable(DRAFT_IMAGE_MODEL) ? IMAGE_JOBS.draft.intent : `${DRAFT_IMAGE_MODEL} (weights missing)`} aria-disabled={!modelAvailable(DRAFT_IMAGE_MODEL)} aria-label={IMAGE_JOBS.draft.intent}>
          {IMAGE_JOBS.draft.chip}
        </button>
        <button type="button" className={chipOn(imageJobId === 'instruction', { muted: !modelAvailable(QWEN_IMAGE_MODEL) })} onClick={applyInstruction} title={modelAvailable(QWEN_IMAGE_MODEL) ? IMAGE_JOBS.instruction.intent : `${QWEN_IMAGE_MODEL} (weights missing)`} aria-disabled={!modelAvailable(QWEN_IMAGE_MODEL)} aria-label={IMAGE_JOBS.instruction.intent}>
          {IMAGE_JOBS.instruction.chip}
        </button>
          </>
        ) : null}
        <button type="button" className={chipOn(imageJobId === 'edit', { muted: !modelAvailable(QWEN_EDIT_IMAGE_MODEL) })} onClick={applyEdit} title={IMAGE_JOBS.edit.intent} aria-disabled={!modelAvailable(QWEN_EDIT_IMAGE_MODEL)} aria-label={IMAGE_JOBS.edit.intent}>
          {IMAGE_JOBS.edit.chip}
        </button>
        <button type="button" className={chipOn(imageJobId === 'faceswap', { muted: !modelAvailable(QWEN_EDIT_IMAGE_MODEL) })} onClick={applyFaceswap} title={IMAGE_JOBS.faceswap.intent} aria-disabled={!modelAvailable(QWEN_EDIT_IMAGE_MODEL)} aria-label={IMAGE_JOBS.faceswap.intent}>
          <UserRound size={10} /> {IMAGE_JOBS.faceswap.chip}
        </button>
        <button type="button" className={chipOn(imageJobId === 'id', { muted: !modelAvailable(QWEN_EDIT_IMAGE_MODEL) })} onClick={applyIdSection} title={IMAGE_JOBS.id.intent} aria-disabled={!modelAvailable(QWEN_EDIT_IMAGE_MODEL)} aria-label={IMAGE_JOBS.id.intent}>
          <CreditCard size={10} /> {IMAGE_JOBS.id.chip}
        </button>
        {!xaiOn ? (
          <>
        <button type="button" className={chipOn(imageJobId === 'klein', { muted: !modelAvailable(KLEIN_IMAGE_MODEL) })} onClick={applyKlein} title={modelAvailable(KLEIN_IMAGE_MODEL) ? IMAGE_JOBS.klein.intent : `${KLEIN_IMAGE_MODEL} (gated / weights missing)`} aria-disabled={!modelAvailable(KLEIN_IMAGE_MODEL)} aria-label={IMAGE_JOBS.klein.intent}>
          {IMAGE_JOBS.klein.chip}
        </button>
        <button
          type="button"
          className={chipOn(imageJobId === 'anime', { muted: !(modelAvailable(ANIME_IMAGE_MODEL) || modelAvailable(PONY_IMAGE_MODEL)) })}
          onClick={applyAnime}
          title={(modelAvailable(ANIME_IMAGE_MODEL) || modelAvailable(PONY_IMAGE_MODEL)) ? IMAGE_JOBS.anime.intent : 'Anime zoo weights missing'}
          aria-disabled={!(modelAvailable(ANIME_IMAGE_MODEL) || modelAvailable(PONY_IMAGE_MODEL))}
          aria-label={IMAGE_JOBS.anime.intent}
        >
          {IMAGE_JOBS.anime.chip}
        </button>
          </>
        ) : null}
        </div>
      </div>

      <div className="mb-3">
        <div className="mb-1 flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[10px] uppercase text-muted">Where it runs</span>
          <span className="font-mono text-[10px] normal-case text-zinc-500">backend only — not a generate action</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={chipOn(!xaiOn)} onClick={() => patch({ imageBackend: 'spark', imageGenEnabled: true })} title="Run jobs on the local Spark GPU bridge">
          Spark GPU
        </button>
        <button type="button" className={chipOn(xaiOn)} onClick={() => patch(xaiImageSettingsPatch(settings))} title="Run jobs on xAI Grok Imagine (cloud)">
          xAI cloud
        </button>
        <button type="button" className="chip hover:border-sky-500/40 hover:text-sky-200" onClick={applySparkLan} title="Point the IDE at Spark on the LAN">
          Point at Spark LAN
        </button>
        <button
          type="button"
          className="chip hover:border-sky-500/40 hover:text-sky-200"
          title="SSH to Spark and start spark_ctl.sh (does not generate an image)"
          onClick={() => {
            const alias = (settings.sparkSshAlias || '').trim();
            if (!alias) {
              toast.info('Set Spark SSH alias in Endpoint first');
              return;
            }
            void window.ablitDesktop?.startSparkImage?.(alias).then((r) => {
              if (r?.ok) toast.success('Spark image start sent', r.log?.slice(0, 120) || alias);
              else toast.error('Spark start failed', r?.error || r?.log || 'ssh failed');
            });
          }}
        >
          Start Spark service
        </button>
        <button type="button" className="chip hover:border-sky-500/40 hover:text-sky-200" onClick={openBridge} title="Open Endpoint settings for URL and token">
          Endpoint settings
        </button>
        <button type="button" disabled={busy} className="chip hover:border-sky-500/40 hover:text-sky-200" onClick={() => void testEndpoint()} title="Ping the image API. Does not create an image.">
          Ping endpoint
        </button>
        {bridgeOffline ? (
          <>
            <button type="button" className="chip hover:border-amber-500/40 hover:text-amber-200" onClick={() => void startTunnelAction()} title="Open NVIDIA Sync / SSH tunnel to :7860">
              Start :7860 tunnel
            </button>
            <button type="button" className="chip hover:border-amber-500/40 hover:text-amber-200" onClick={() => void copyStartCommand()} title="Copy the Spark start command">
              Copy Spark start cmd
            </button>
          </>
        ) : null}
        </div>
      </div>

      <div className="section-card mb-3 max-w-3xl">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 text-left"
          onClick={() => setRecipeOpen((o) => !o)}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            {recipeOpen ? <ChevronDown size={12} className="shrink-0 text-muted" /> : <ChevronRight size={12} className="shrink-0 text-muted" />}
            <span className="section-card-title">Recipe</span>
          </div>
          {!recipeOpen ? (
            <span className="truncate font-mono text-[10px] text-zinc-500">
              {isQualityPath
                ? `Build D · ${BUILD_D.steps}/${BUILD_D.cfg}/LoRA ${BUILD_D.loraStrength} · :${BUILD_D.imagePort}+:${BUILD_D.textPort}`
                : `${activeModelLabel}${isStubPath ? ' · stub / secondary' : ''}`}
            </span>
          ) : null}
        </button>
        {recipeOpen ? (
          <>
            <p className="section-card-hint mt-1">
              Build D: Hero Krea RAW → Huihui TE → Prompt LLM :{BUILD_D.textPort} → Klein / Edit / SeedVR2. No Comfy.
            </p>
            {isQualityPath ? (
              <p className="mt-1 font-mono text-[10px] text-zinc-400">
                Krea2Pipeline · {BUILD_D.steps} / {BUILD_D.cfg} / euler+beta · LoRA {BUILD_D.loraStrength} · Huihui TE · max {BUILD_D.maxEdgeMin}–{BUILD_D.maxEdgeMax}
              </p>
            ) : (
              <p className="mt-1 font-mono text-[10px] text-zinc-400">
                Path · {activeModelLabel}{isStubPath ? ' · stub / secondary (not Build D hero)' : ''}
              </p>
            )}
            <div className="section-card-body overflow-x-auto">
              <table className="w-full font-mono text-[10px] text-zinc-300">
                <tbody>
                  <tr><td className="pr-3 text-muted">Build</td><td>D</td></tr>
                  <tr><td className="pr-3 text-muted">Hero DiT</td><td><code>{BUILD_D.heroDit}</code> (<code>{BUILD_D.heroModelId}</code>)</td></tr>
                  <tr><td className="pr-3 text-muted">Uncensor LoRA</td><td>strength <strong>{BUILD_D.loraStrength}</strong>, <code>{BUILD_D.uncensorLora}</code></td></tr>
                  <tr><td className="pr-3 text-muted">TE</td><td>Huihui abliterated Qwen3-VL-4B</td></tr>
                  <tr><td className="pr-3 text-muted">Sampler</td><td>euler+beta {BUILD_D.steps}/{BUILD_D.cfg}</td></tr>
                  <tr><td className="pr-3 text-muted">Canvas</td><td>{BUILD_D.maxEdgeMin}–{BUILD_D.maxEdgeMax}; SeedVR2 later</td></tr>
                  <tr><td className="pr-3 text-muted">Instruction / Edit</td><td><code>{BUILD_D.instructionPath}</code> / <code>{BUILD_D.editPath}</code></td></tr>
                  <tr><td className="pr-3 text-muted">Second / Draft</td><td><code>{BUILD_D.secondPath}</code> / <code>{BUILD_D.draftPath}</code></td></tr>
                  <tr><td className="pr-3 text-muted">Runtime</td><td>{BUILD_D.runtime}</td></tr>
                  <tr><td className="pr-3 text-muted">Ports</td><td>:{BUILD_D.imagePort} image + :{BUILD_D.textPort} text</td></tr>
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>

      {isIdPath ? (
        <div className="section-card mb-4 max-w-[96rem]">
          <div className="section-card-title">ID document</div>
          <p className="section-card-hint">
            Spark Qwen-Edit only — not LaMa, ESRGAN, StyleGAN, or a hosted verify API. Portrait swap replaces the photo
            window; printed text and graphics are copied from the scan. Capture look is a real phone photo on timber:
            uneven daylight, slight reflection, no glare, no fingers. Min edge {ID_MIN_EDGE_PX}px. No synthetic identity.
          </p>
          <div className="section-card-body">
            <div className="grid gap-2 md:grid-cols-3">
              <ImageDropSlot
                label="Front"
                preview={refImagePreview}
                dragOver={refDragOver}
                emptyHint="Front of the document (required)"
                onPick={loadRefFile}
                onClear={clearRefImage}
                onUsePreview={previewSrc ? usePreviewAsTarget : undefined}
                fileRef={refFileInputRef}
                setDragOver={setRefDragOver}
              />
              <ImageDropSlot
                label="Back (optional)"
                preview={backImagePreview}
                dragOver={backDragOver}
                emptyHint="Back scan for a cleanup pass"
                onPick={loadBackFile}
                onClear={clearBackImage}
                fileRef={backFileInputRef}
                setDragOver={setBackDragOver}
              />
              <ImageDropSlot
                label="Headshot (optional)"
                preview={idImagePreview}
                dragOver={idDragOver}
                emptyHint="Face crop for portrait swap"
                onPick={loadIdFile}
                onClear={clearIdImage}
                fileRef={idFileInputRef}
                setDragOver={setIdDragOver}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block font-mono text-[10px] uppercase text-muted">
                ID type
                <select
                  className="field mt-1"
                  value={idDocType}
                  onChange={(e) => setIdDocType(e.target.value as IdDocType)}
                >
                  {ID_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block font-mono text-[10px] uppercase text-muted">
                Country code
                <input
                  className="field mt-1"
                  value={idCountry}
                  onChange={(e) => setIdCountry(e.target.value.toUpperCase().slice(0, 3))}
                  placeholder="AU"
                  maxLength={3}
                />
              </label>
            </div>
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase text-muted">ID template</div>
              <div className="flex flex-wrap gap-1">
                {ID_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={chipOn(idTemplateId === t.id)}
                    title={t.hint}
                    onClick={() => applyIdTemplate(t)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={busy || !refImageB64}
                title="Edit the front scan while keeping printed text and graphics"
                onClick={() => void runIdAlteration()}
              >
                Run alteration
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy || !refImageB64}
                title="Build a licence + selfie pair from the front scan"
                onClick={() => void runIdLicenceSelfie()}
              >
                Run licence selfie
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy || !refImageB64}
                title="Clean the front scan only"
                onClick={() => void runIdKind('clean')}
              >
                Clean front scan
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy || !refImageB64 || !idImageB64}
                title="Replace the photo window with the headshot. Printed text stays."
                onClick={() => void runIdKind('portrait')}
              >
                Replace ID portrait
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy || !backImageB64}
                title="Clean the back scan only"
                onClick={() => void runIdKind('back')}
              >
                Clean back scan
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy || !refImageB64}
                title="Run clean front, portrait swap if a headshot is set, then clean back if present"
                onClick={() => void runIdPipeline()}
              >
                Run all ID steps
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-3">
          <div className="section-card" ref={generateCardRef}>
            <div className="section-card-title">{imageJob.title}</div>
            <p className="section-card-hint">{imageJob.intent}</p>
            <div className="section-card-body">
              {isEditPath && !isIdPath ? (
                isFaceswapPath ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <ImageDropSlot
                      label="Identity (face)"
                      preview={idImagePreview}
                      dragOver={idDragOver}
                      emptyHint="Face / ID photo — the person to copy"
                      onPick={loadIdFile}
                      onClear={clearIdImage}
                      fileRef={idFileInputRef}
                      setDragOver={setIdDragOver}
                    />
                    <ImageDropSlot
                      label="Target (scene)"
                      preview={refImagePreview}
                      dragOver={refDragOver}
                      emptyHint="Photo to put that face on"
                      onPick={loadRefFile}
                      onClear={clearRefImage}
                      onUsePreview={previewSrc ? usePreviewAsTarget : undefined}
                      fileRef={refFileInputRef}
                      setDragOver={setRefDragOver}
                    />
                  </div>
                ) : (
                  <ImageDropSlot
                    label="Reference image"
                    preview={refImagePreview}
                    dragOver={refDragOver}
                    emptyHint="Drop an image or click to choose — required for Edit"
                    onPick={loadRefFile}
                    onClear={clearRefImage}
                    fileRef={refFileInputRef}
                    setDragOver={setRefDragOver}
                  />
                )
              ) : null}

              <label className="block font-mono text-[10px] uppercase text-muted">
                <span className="flex items-center justify-between gap-2">
                  {isIdPath ? 'Notes (optional)' : isFaceswapPath ? 'Swap notes (optional)' : isEditPath ? 'Edit instruction' : 'Prompt'}
                  <button type="button" className="chip text-[9px] normal-case" onClick={() => setHistoryOpen((o) => !o)} title="Prompt history">
                    <History size={10} /> History
                  </button>
                </span>
                <textarea
                  ref={promptRef}
                  value={prompt}
                  onChange={(e) => { setPrompt(e.target.value); historyCursorRef.current = -1; }}
                  onKeyDown={onPromptKeyDown}
                  rows={4}
                  className="field mt-1 resize-y"
                  placeholder={
                    isIdPath
                      ? 'Optional notes. Capture look is already timber + phone camera; printed text is never rewritten.'
                      : isFaceswapPath
                        ? 'Optional: keep the beard, look left… Empty uses a full ID-swap brief.'
                        : isEditPath
                          ? 'Describe the edit… (↑/↓ history)'
                          : 'Describe the image… (↑/↓ history)'
                  }
                />
                {historyOpen && promptHistory.length > 0 ? (
                  <div className="mt-1.5 max-h-28 overflow-auto rounded border border-border bg-background p-1">
                    {promptHistory.map((h, i) => (
                      <button
                        key={`${i}-${h.slice(0, 24)}`}
                        type="button"
                        className="block w-full truncate rounded px-1.5 py-0.5 text-left font-mono text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                        onClick={() => { setPrompt(h); setHistoryOpen(false); promptRef.current?.focus(); }}
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                ) : null}
                {!isEditPath ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {PROMPT_SUGGESTIONS.map((sug, i) => (
                      <button key={i} type="button" onClick={() => setPrompt(sug)} className="chip text-[9px] hover:border-sky-500/40 hover:text-sky-200">
                        {sug}
                      </button>
                    ))}
                  </div>
                ) : null}
              </label>

              <div>
                <div className="mb-1 font-mono text-[10px] uppercase text-muted">
                  Media frame
                  <span className="ml-1 normal-case text-zinc-500">
                    {isIdPath
                      ? '· ID/passport keeps real card ratio, never stretched'
                      : '· content keeps source ratio, never stretched'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {IMAGE_RATIOS.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className={chipOn(ratioId === r.id)}
                      aria-pressed={ratioId === r.id}
                      title={
                        r.id === 'auto'
                          ? isIdPath
                            ? 'Media matches ISO ID-1 / passport ID-3. Document is never stretched.'
                            : 'Media matches the source. Content is never stretched.'
                          : isIdPath
                            ? `Media frame ${r.label}. ID/passport stays real card size (letterboxed).`
                            : `Media frame ${r.label}. Source content keeps its own ratio (letterboxed).`
                      }
                      onClick={() => setRatioId(r.id)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 font-mono text-[10px] uppercase text-muted">
                  Long edge
                  <span className="ml-1 normal-case text-zinc-500">
                    {ratioId === 'auto'
                      ? isIdPath
                        ? '· Auto uses real ID/passport size'
                        : '· Auto keeps source ratio'
                      : `· ${sizeForRatio(ratioId, longEdge)}`}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {LONG_EDGES.map((e) => (
                    <button
                      key={e}
                      type="button"
                      className={chipOn(longEdge === e)}
                      aria-pressed={longEdge === e}
                      onClick={() => setLongEdge(e)}
                    >
                      {e}{e === 1328 ? ' RAW' : e === 1536 ? ' max' : ''}
                    </button>
                  ))}
                </div>
              </div>

              {!isIdPath ? (
                <div>
                  <div className="mb-1 font-mono text-[10px] uppercase text-muted">Batch</div>
                  <div className="flex flex-wrap gap-1">
                    {BATCH_NS.map((n) => (
                      <button key={n} type="button" className={chipOn(batchN === n)} aria-pressed={batchN === n} onClick={() => setBatchN(n)}>
                        n={n}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <label className="block font-mono text-[10px] uppercase text-muted">
                Model
                {xaiOn ? (
                  <select
                    value={settings.xaiImageModel || XAI_IMAGE_MODEL}
                    onChange={(e) => patch({ xaiImageModel: e.target.value })}
                    className="field mt-1"
                  >
                    <option value={XAI_IMAGE_MODEL}>Grok Imagine 2.0</option>
                  </select>
                ) : (
                  <select ref={modelSelectRef} value={modelSelectValue} onChange={(e) => { const v = e.target.value; if (v === MODEL_CUSTOM) { if (knownModelIds.includes(settings.imageModel)) patch({ imageModel: '' }); return; } patch({ imageModel: v }); }} className="field mt-1">
                    {IMAGE_MODEL_OPTIONS.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                    <option value={MODEL_CUSTOM}>Custom…</option>
                  </select>
                )}
              </label>
              {!xaiOn && showCustomModel ? (
                <label className="block font-mono text-[10px] uppercase text-muted">
                  Custom model id
                  <input value={settings.imageModel} onChange={(e) => patch({ imageModel: e.target.value })} className="field mt-1" placeholder="model id" />
                </label>
              ) : null}
              {xaiOn ? (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block font-mono text-[10px] uppercase text-muted">
                    Resolution
                    <select
                      value={settings.xaiImageResolution || '2k'}
                      onChange={(e) => patch({ xaiImageResolution: e.target.value === '1k' ? '1k' : '2k' })}
                      className="field mt-1"
                    >
                      {XAI_RESOLUTIONS.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block font-mono text-[10px] uppercase text-muted">
                    Quality
                    <select
                      value={settings.xaiImageQuality || 'auto'}
                      onChange={(e) =>
                        patch({
                          xaiImageQuality:
                            e.target.value === 'low' || e.target.value === 'medium' ? e.target.value : 'auto',
                        })
                      }
                      className="field mt-1"
                    >
                      {XAI_QUALITIES.map((q) => (
                        <option key={q} value={q}>{q}</option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={
                    busy ||
                    (isIdPath
                      ? !refImageB64
                      : isFaceswapPath
                        ? !refImageB64 || !idImageB64
                        : !prompt.trim() || (isEditPath && !refImageB64))
                  }
                  onClick={() => {
                    if (isIdPath) void runIdPipeline();
                    else void generate();
                  }}
                  className="btn-primary"
                  aria-label={imageJob.action}
                  title={
                    isIdPath && !refImageB64
                      ? 'Add a front scan first'
                      : isFaceswapPath && (!refImageB64 || !idImageB64)
                        ? 'Add identity + target images first'
                        : isEditPath && !refImageB64
                          ? 'Add a reference image first'
                          : imageJob.intent
                  }
                >
                  {busy ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 size={12} className="spin-slow" /> Running {imageJob.chip.toLowerCase()}…
                      {progressLabel ? ` ${progressLabel}` : ''}
                    </span>
                  ) : (
                    imageJob.action
                  )}
                </button>
                {busy ? (
                  <button type="button" onClick={cancelGenerate} className="btn-danger" title="Cancel this job">Stop this job</button>
                ) : (
                  <>
                  <button type="button" disabled={busy} onClick={() => void testEndpoint()} className="btn-ghost" title="Ping the image API. Does not create an image.">
                    Ping endpoint
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="btn-ghost"
                    title="Create one tiny image to prove the backend works. Not the quality job."
                    onClick={() => {
                      void (async () => {
                        setBusy(true);
                        setError('');
                        try {
                          const r = await generateTestImage(settings);
                          setB64(r.b64 || null);
                          setRemoteUrl(r.url || null);
                          toast.success('Smoke generate ok');
                        } catch (err) {
                          const { friendly, detail } = friendlyImageError(err);
                          setError(detail);
                          toast.error(friendly.split('.')[0] || 'Smoke generate failed');
                        } finally {
                          setBusy(false);
                        }
                      })();
                    }}
                  >
                    Smoke generate
                  </button>
                  </>
                )}
                {busy ? <span className="status-badge status-badge--busy">Generating… {progressLabel || ''}</span> : null}
                {progressFailed && !busy ? <span className="status-badge status-badge--err">Failed</span> : null}
              </div>
              {busy || progress != null ? (
                <div className="image-progress" aria-live="polite">
                  <div className="image-progress-track">
                    <div
                      className={cn(
                        'image-progress-fill',
                        progressFailed && 'image-progress-fill--err',
                        progressIndeterminate && 'image-progress-fill--indeterminate',
                      )}
                      style={
                        progressIndeterminate
                          ? undefined
                          : { width: `${Math.min(100, Math.max(0, progress ?? 0))}%` }
                      }
                    />
                  </div>
                  <div className="image-progress-label">{progressFailed ? (busy ? 'Stopping…' : 'Generation failed') : progressLabel || softStatus}</div>
                </div>
              ) : null}
              {error ? (
                <div>
                  <button type="button" className="status-badge status-badge--err" onClick={() => setErrorOpen((o) => !o)}>
                    {isBridgeOfflineError(error) ? 'Bridge offline — details' : `Error — ${errorOpen ? 'hide' : 'details'}`}
                  </button>
                  {errorOpen ? <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-red-400">{error}</pre> : null}
                  {isBridgeOfflineError(error) && !errorOpen ? (
                    <p className="mt-1 font-mono text-[10px] text-zinc-500">See the status card above to reconnect.</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          <div className="section-card">
            <button type="button" className="flex w-full items-center justify-between gap-2 text-left" onClick={() => { setEndpointUserToggled(true); setEndpointOpen((o) => !o); }}>
              <div className="flex min-w-0 items-center gap-1.5">
                {endpointOpen ? <ChevronDown size={12} className="shrink-0 text-muted" /> : <ChevronRight size={12} className="shrink-0 text-muted" />}
                <span className="section-card-title">Endpoint</span>
              </div>
              {!endpointOpen ? <span className="truncate font-mono text-[10px] text-zinc-500">{endpointSummary}</span> : null}
            </button>
            {endpointOpen ? (
              <>
                <p className="section-card-hint">Connection only. Spark is the local Diffusers bridge; xAI Imagine is optional cloud (`grok-imagine-image-2.0`).</p>
                <div className="section-card-body">
                  <div className="switch-row">
                    <label className="switch-row-main">
                      <span>Enabled</span>
                      <input type="checkbox" checked={settings.imageGenEnabled} onChange={(e) => patch({ imageGenEnabled: e.target.checked })} />
                    </label>
                  </div>
                  <div>
                    <div className="mb-1 font-mono text-[10px] uppercase text-muted">Backend</div>
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        className={chipOn(!xaiOn)}
                        aria-pressed={!xaiOn}
                        onClick={() => patch({ imageBackend: 'spark', imageGenEnabled: true })}
                      >
                        Spark (local)
                      </button>
                      <button
                        type="button"
                        className={chipOn(xaiOn)}
                        aria-pressed={xaiOn}
                        onClick={() => patch(xaiImageSettingsPatch(settings))}
                      >
                        xAI Imagine
                      </button>
                    </div>
                  </div>
                  {xaiOn ? (
                    <>
                      <label className="block font-mono text-[10px] uppercase text-muted">
                        xAI base URL
                        <input
                          value={settings.xaiImageBaseUrl}
                          onChange={(e) => patch({ xaiImageBaseUrl: e.target.value })}
                          className="field mt-1"
                          placeholder="https://api.x.ai/v1"
                        />
                      </label>
                      <label className="block font-mono text-[10px] uppercase text-muted">
                        xAI API key
                        <input
                          type="password"
                          value={settings.xaiImageToken}
                          onChange={(e) => patch({ xaiImageToken: e.target.value })}
                          className="field mt-1"
                          placeholder="xai-…"
                          autoComplete="off"
                        />
                      </label>
                    </>
                  ) : (
                    <>
                  <label className="block font-mono text-[10px] uppercase text-muted">
                    Base URL
                    <input value={settings.imageBaseUrl} onChange={(e) => patch({ imageBaseUrl: e.target.value })} className="field mt-1" />
                  </label>
                  <label className="block font-mono text-[10px] uppercase text-muted">
                    Token
                    <input type="password" value={settings.imageToken} onChange={(e) => patch({ imageToken: e.target.value })} className="field mt-1" placeholder="••••••••" autoComplete="off" />
                  </label>
                  <div className="switch-row">
                    <label className="switch-row-main">
                      <span>Via Vite proxy (/image-v1)</span>
                      <input type="checkbox" checked={settings.imageViaProxy === true} onChange={(e) => patch({ imageViaProxy: e.target.checked })} />
                    </label>
                    <p className="switch-row-help">
                      {isElectronDesktop()
                        ? 'Electron talks raw :7860 / LAN — leave off unless you know you need the Vite rewrite.'
                        : 'DEV same-origin rewrite for local image servers.'}
                    </p>
                  </div>
                    </>
                  )}
                  {proxyOnUpstreamDown ? (
                    <p className="font-mono text-[10px] text-amber-300/90">
                      Proxy is on but upstream is down — try turning Via proxy off, or Start tunnel / Use LAN.
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate font-mono text-[10px] text-zinc-500">POST {imageEndpointUrl(settings, '/images/generations')}</div>
                    {healthPill}
                  </div>
                  {testNote && (testDetailOpen || testOk === true) ? <pre className="whitespace-pre-wrap font-mono text-[10px] text-zinc-400">{testNote}</pre> : null}
                  {testOk === false && !testDetailOpen ? (
                    <button type="button" className="font-mono text-[10px] text-zinc-500 underline hover:text-zinc-300" onClick={() => setTestDetailOpen(true)}>Show error details</button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </div>
        <div className="section-card flex flex-col">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="section-card-title">Preview</div>
            <button type="button" disabled={!previewSrc} onClick={() => download()} className="btn-ghost h-7 px-2 text-[10px]">
              <Download size={11} /> Download
            </button>
          </div>
          <div className="relative min-h-[16rem] flex-1">
            {busy && !previewSrc ? (
              <div className="image-empty">
                <Loader2 size={18} className="spin-slow text-sky-400" />
                <span>Generating… {progressLabel || ''}</span>
              </div>
            ) : previewSrc ? (
              <div onClick={() => setLightboxImage({ src: previewSrc, prompt: prompt || 'Generated image' })} className="group relative flex max-h-[70vh] w-full cursor-zoom-in items-center justify-center overflow-hidden rounded">
                <img src={previewSrc} alt="generated" className="max-h-[70vh] w-full rounded object-contain" />
                <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/40 font-mono text-xs text-zinc-100 opacity-0 transition-opacity group-hover:opacity-100">
                  <Maximize2 size={16} /> Click to zoom
                </div>
              </div>
            ) : (
              <div className="image-empty">
                <div className="image-empty-frame" aria-hidden />
                <span>No image yet</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="section-card mt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="section-card-title">Library</div>
            <p className="section-card-hint">
              Saved under <code className="text-zinc-400">.ablit/images/</code> when the bridge is connected; otherwise IndexedDB. Keeps last {IMAGE_LIBRARY_MAX}.
            </p>
          </div>
          <button type="button" className="btn-ghost h-7 px-2 text-[10px]" onClick={() => void refreshLibrary()}>Refresh</button>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input value={libQuery} onChange={(e) => setLibQuery(e.target.value)} className="field max-w-xs" placeholder="Search prompts…" />
          {libraryModels.map((m) => (
            <button key={m} type="button" className={chipOn(filterModel === m)} onClick={() => setFilterModel(filterModel === m ? null : m)}>{m.length > 28 ? `${m.slice(0, 26)}…` : m}</button>
          ))}
          {librarySizes.map((s) => (
            <button key={s} type="button" className={chipOn(filterSize === s)} onClick={() => setFilterSize(filterSize === s ? null : s)}>{s}</button>
          ))}
        </div>
        {selectedIds.size > 0 ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-border bg-background/60 px-2 py-1.5">
            <span className="font-mono text-[10px] text-zinc-400">{selectedIds.size} selected</span>
            <button type="button" className="btn-ghost h-6 px-2 text-[10px]" onClick={() => void bulkDownload()}><Download size={10} /> Download</button>
            <button type="button" className="btn-ghost h-6 px-2 text-[10px]" onClick={() => void startCompare()}><Columns2 size={10} /> Compare</button>
            <button type="button" className="btn-ghost h-6 px-2 text-[10px] text-red-300/90" onClick={() => void bulkDelete()}><Trash2 size={10} /> Delete</button>
            <button type="button" className="btn-ghost h-6 px-2 text-[10px]" onClick={clearSelection}>Clear</button>
          </div>
        ) : null}
        {libraryNote ? <pre className="mb-2 whitespace-pre-wrap font-mono text-[10px] text-amber-300/90">{libraryNote}</pre> : null}
        {libraryLoading && library.length === 0 ? (
          <div className="image-library-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="image-library-card image-library-skeleton" aria-hidden>
                <div className="image-library-thumb image-skeleton-pulse" />
                <div className="image-skeleton-pulse h-2 rounded bg-zinc-800" />
              </div>
            ))}
          </div>
        ) : filteredLibrary.length === 0 ? (
          <div className="image-empty min-h-[8rem]"><span>{library.length === 0 ? 'No saved images yet' : 'No matches'}</span></div>
        ) : (
          <div className="image-library-grid">
            {filteredLibrary.map((entry) => {
              const thumb = thumbUrls[entry.id];
              const selected = selectedIds.has(entry.id);
              return (
                <div key={entry.id} className={cn('image-library-card', selected && 'image-library-card--selected')}>
                  <div className="relative">
                    <button type="button" className="absolute left-1 top-1 z-10 rounded border border-border bg-black/70 p-0.5 text-zinc-300 hover:text-zinc-100" onClick={() => toggleSelect(entry.id)} aria-pressed={selected} title={selected ? 'Deselect' : 'Select'}>
                      {selected ? <CheckSquare size={12} /> : <Square size={12} />}
                    </button>
                    <button type="button" className="image-library-thumb" onClick={() => { const src = thumbUrls[entry.id]; if (src) setLightboxImage({ src, prompt: entry.prompt }); else void openLibraryEntry(entry); }} title={entry.prompt}>
                      {thumb ? <img src={thumb} alt="" /> : <span className="image-skeleton-pulse block h-full w-full bg-zinc-900" />}
                      <span className="image-library-hover">{entry.prompt || '(no prompt)'}</span>
                    </button>
                  </div>
                  <div className="image-library-meta">
                    <div className="image-library-prompt" title={entry.prompt}>{entry.prompt || '(no prompt)'}</div>
                    <div className="image-library-sub">{formatWhen(entry.createdAt)} · {entry.size} · {entry.model || '—'} · {entry.storage}</div>
                    <div className="image-library-actions">
                      <button type="button" className="btn-ghost h-6 px-1.5 text-[10px]" onClick={() => { const src = thumbUrls[entry.id]; if (src) setLightboxImage({ src, prompt: entry.prompt }); else void openLibraryEntry(entry); }}><Eye size={10} /> View</button>
                      <button type="button" className="btn-ghost h-6 px-1.5 text-[10px]" onClick={() => useFromLibrary(entry)}>Reuse</button>
                      <button type="button" className="btn-ghost h-6 px-1.5 text-[10px]" onClick={() => { const src = thumbUrls[entry.id]; if (src) download(src, `${entry.id}.png`); else void getLibraryImageDataUrl(entry).then((u) => u && download(u, `${entry.id}.png`)); }}><Download size={10} /></button>
                      {entry.storage === 'disk' ? <button type="button" className="btn-ghost h-6 px-1.5 text-[10px]" onClick={() => void revealOnDisk(entry)} title="Reveal on disk"><FolderOpen size={10} /></button> : null}
                      <button type="button" className="btn-ghost h-6 px-1.5 text-[10px] text-red-300/90" onClick={() => void removeLibraryEntry(entry)}><Trash2 size={10} /></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {lightboxImage ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md modal-animate-in" onClick={() => setLightboxImage(null)}>
          <div className="relative flex max-h-[90vh] max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl shadow-black" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border bg-surface-raised px-4 py-2 font-mono text-xs">
              <span className="max-w-md truncate text-zinc-200">{lightboxImage.prompt}</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => download(lightboxImage.src, 'image.png')} className="btn-ghost h-6 px-2 text-[10px]"><Download size={11} /> Download</button>
                <button type="button" onClick={() => setLightboxImage(null)} className="rounded p-1 text-zinc-400 hover:text-zinc-100"><X size={14} /></button>
              </div>
            </div>
            <div className="flex items-center justify-center overflow-auto bg-black/90 p-2">
              <img src={lightboxImage.src} alt="full-size" className="max-h-[78vh] rounded object-contain" />
            </div>
          </div>
        </div>
      ) : null}

      {comparePair ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md modal-animate-in" onClick={() => setComparePair(null)}>
          <div className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl shadow-black" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border bg-surface-raised px-4 py-2 font-mono text-xs">
              <span className="text-zinc-200">Compare</span>
              <button type="button" onClick={() => setComparePair(null)} className="rounded p-1 text-zinc-400 hover:text-zinc-100"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-1 gap-2 overflow-auto bg-black/90 p-2 md:grid-cols-2">
              {[comparePair.left, comparePair.right].map((side, i) => (
                <div key={i} className="flex min-w-0 flex-col gap-1">
                  <div className="truncate px-1 font-mono text-[10px] text-zinc-400">{side.prompt}</div>
                  <img src={side.src} alt={`compare-${i}`} className="max-h-[75vh] w-full rounded object-contain" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

