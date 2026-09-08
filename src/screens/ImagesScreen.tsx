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
  X,
} from 'lucide-react';
import { useToast } from '../components/common/Toast';
import { bridge } from '../lib/bridgeClient';
import { cn } from '../lib/cn';
import { friendlyImageError, generateImage, imageEndpointUrl, isBridgeOfflineError, pingImageEndpoint } from '../lib/imageGen';
import {
  IMAGE_LIBRARY_MAX,
  deleteLibraryImage,
  estimateImageProgress,
  getLibraryImageDataUrl,
  listLibraryImages,
  saveGeneratedImage,
  type StoredImageMeta,
} from '../lib/imageLibrary';
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
  SPARK_CHAT_MODEL,
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

const SIZES = [
  { id: '1328x1328', label: '1:1 1328 (RAW)' },
  { id: '1536x1536', label: '1:1 1536 max' },
  { id: '1024x1024', label: '1:1 1024' },
  { id: '768x768', label: '1:1 768' },
  { id: '512x512', label: '1:1 512' },
] as const;

type SizeId = (typeof SIZES)[number]['id'];

const BATCH_NS = [1, 2, 3, 4] as const;
const PROMPT_HISTORY_KEY = 'ablit_image_prompt_history';
const PROMPT_HISTORY_MAX = 20;
const MODEL_CUSTOM = '__custom__';

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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function stripDataUrlBase64(dataUrl: string): string {
  const s = (dataUrl || '').trim();
  if (s.startsWith('data:') && s.includes(',')) return s.split(',', 1)[1] || '';
  return s;
}

function chipOn(on: boolean, opts?: { muted?: boolean }) {
  return cn(
    'chip',
    opts?.muted && 'opacity-40 cursor-not-allowed hover:border-zinc-700 hover:text-zinc-500',
    on && !opts?.muted && 'border-emerald-700/80 bg-emerald-950/50 text-emerald-300 hover:border-emerald-600 hover:text-emerald-200',
  );
}

export function ImagesScreen({ settings, onSettingsChange }: Props) {
  const toast = useToast();
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<SizeId>('1024x1024');
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

  const thumbCache = useRef<Record<string, string>>({});
  const progressEstRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
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
  }, [settings.imageGenEnabled, settings.imageBaseUrl, settings.imageViaProxy, settings.imageToken]);

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
        model: model || settings.imageModel || UNCENSORED_IMAGE_MODEL,
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

  const loadRefFile = async (file: File | null | undefined) => {
    if (!file || !file.type.startsWith('image/')) {
      toast.warning('Pick an image file');
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setRefImagePreview(dataUrl);
      setRefImageB64(stripDataUrlBase64(dataUrl) || null);
    } catch (err) {
      toast.error('Could not read image', err instanceof Error ? err.message : String(err));
    }
  };

  const generate = async () => {
    const p = prompt.trim();
    if (!p || busy) return;
    const resolvedForGate = resolveSparkImageModel(settings.imageModel);
    const editNeedsRef = resolvedForGate === QWEN_EDIT_IMAGE_MODEL;
    if (editNeedsRef && !refImageB64) {
      toast.warning('Edit needs a reference image', 'Drop or choose an image above Generate');
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setBusy(true);
    setError('');
    setErrorOpen(false);
    setB64(null);
    setRemoteUrl(null);
    setProgress(0);
    setProgressEst(true);
    progressEstRef.current = true;
    setProgressFailed(false);
    setPromptHistory(pushPromptHistory(p));
    historyCursorRef.current = -1;

    const started = Date.now();
    const tick = window.setInterval(() => {
      setProgress((prev) => {
        if (prev != null && prev >= 100) return prev;
        const est = estimateImageProgress(Date.now() - started);
        if (prev != null && !progressEstRef.current && prev >= est) return prev;
        progressEstRef.current = true;
        setProgressEst(true);
        return est;
      });
    }, 200);

    try {
      const resolvedModel = resolveSparkImageModel(settings.imageModel);
      const isQuality = resolvedModel === UNCENSORED_IMAGE_MODEL;
      const isEdit = resolvedModel === QWEN_EDIT_IMAGE_MODEL;
      const isDraftOrFast =
        resolvedModel === DRAFT_IMAGE_MODEL || resolvedModel === FAST_IMAGE_MODEL;
      const genExtras = isQuality
        ? {
            steps: BUILD_D.steps,
            guidance: BUILD_D.cfg,
            loraStrength: BUILD_D.loraStrength,
            intent: 'generate' as const,
          }
        : isEdit
          ? { intent: 'edit' as const }
          : isDraftOrFast || resolvedModel === QWEN_IMAGE_MODEL
            ? { intent: 'generate' as const }
            : {};
      const result = await generateImage({
        settings,
        prompt: p,
        size,
        n: batchN,
        model: resolvedModel,
        ...genExtras,
        ...(isEdit && refImageB64 ? { imageB64: refImageB64 } : {}),
        abortSignal: ac.signal,
        onProgress: (pct, estimated) => {
          progressEstRef.current = estimated;
          setProgress((prev) => Math.max(prev ?? 0, pct));
          setProgressEst(estimated);
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
      } else {
        for (const img of all) {
          await persistResult(img, p, size);
        }
      }
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
    } finally {
      window.clearInterval(tick);
      setBusy(false);
      if (abortRef.current === ac) abortRef.current = null;
      window.setTimeout(() => {
        setProgress(null);
        setProgressFailed(false);
      }, 700);
    }
  };

  const onPromptKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void generate();
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
    const sz = (SIZES.find((s) => s.id === entry.size)?.id || '1024x1024') as SizeId;
    setSize(sz);
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
    setBusy(true);
    setProgress(0);
    setProgressEst(true);
    progressEstRef.current = true;
    setProgressFailed(false);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const started = Date.now();
    const tick = window.setInterval(() => {
      setProgress(estimateImageProgress(Date.now() - started, 8000));
      setProgressEst(true);
    }, 150);
    try {
      const result = await generateImage({
        settings: { ...settings, imageGenEnabled: true },
        prompt: 'tiny red square test',
        size: '512x512',
        abortSignal: ac.signal,
        onProgress: (pct, estimated) => {
          progressEstRef.current = estimated;
          setProgress((prev) => Math.max(prev ?? 0, pct));
          setProgressEst(estimated);
        },
      });
      const note = result.b64
        ? `ok b64 (${result.b64.length} chars)`
        : result.url
          ? `ok url ${result.url}`
          : 'empty';
      setTestNote(note);
      setTestOk(!!(result.b64 || result.url));
      if (result.b64) setB64(result.b64);
      if (result.url) setRemoteUrl(result.url);
      setProgress(100);
      if (result.b64 || result.url) await persistResult(result, 'tiny red square test', '512x512');
      if (!endpointUserToggled) setEndpointOpen(false);
    } catch (err) {
      if (isAbortError(err)) {
        setTestNote('Cancelled');
        setTestOk(null);
      } else {
        const { friendly, detail } = friendlyImageError(err);
        setTestNote(detail);
        setTestOk(false);
        setTestDetailOpen(false);
        setProgressFailed(true);
        toast.error(friendly.split('.')[0] || 'Bridge offline', 'See the status card for Start tunnel / Use LAN');
        if (!endpointUserToggled) setEndpointOpen(true);
      }
    } finally {
      window.clearInterval(tick);
      setBusy(false);
      if (abortRef.current === ac) abortRef.current = null;
      window.setTimeout(() => {
        setProgress(null);
        setProgressFailed(false);
      }, 700);
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
    if ((settings.sparkLanHost || '').trim()) patch(sparkImageSettingsPatch(settings, model));
    else patch({ imageModel: resolveSparkImageModel(model) });
  };

  const applyQuality = () => {
    setSize('1328x1328');
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
      toast.info('Edit — Qwen-Edit', QWEN_EDIT_IMAGE_MODEL);
    });
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

  const applySparkQwen = () => {
    const p = sparkChatSettingsPatch(settings);
    patch(p);
    toast.success('Chat → Spark Qwen', `${p.sparkBaseUrl} · ${SPARK_CHAT_MODEL}`);
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

  const progressLabel =
    progress == null
      ? null
      : progressFailed
        ? busy
          ? 'Stopping…'
          : 'Failed'
        : progress >= 100
          ? '100%'
          : progressEst
            ? `~${progress}% (est.)`
            : `${progress}%`;

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
    settings.imageViaProxy === true && testOk === false && !healthChecking;
  const bridgeOffline = settings.imageGenEnabled && testOk === false && !healthChecking;

    const endpointSummary = `${settings.imageModel || '—'} · ${hostFromBaseUrl(settings.imageBaseUrl)} · ${
    healthChecking ? 'checking' : testOk === true ? 'ok' : testOk === false ? 'unreachable' : '—'
  }`;
  if (!settings.imageGenEnabled) {
    return (
      <div className="h-full overflow-auto p-4">
        <header className="page-header">
          <div className="flex items-center gap-2 page-header-title">
            <ImageIcon size={14} /> Images
          </div>
          <p className="page-header-sub">Local OpenAI-compatible image generation on Spark (not cloud).</p>
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
          Prompt to local endpoint · Cmd/Ctrl+Enter generate · Esc closes zoom · G focuses prompt
        </p>
      </header>

      {bridgeOffline ? (
        <div className="mb-3 max-w-3xl rounded border border-amber-700/50 bg-amber-950/30 px-3 py-2.5">
          <div className="font-mono text-[12px] font-medium text-amber-200">Spark image bridge offline</div>
          <p className="mt-1 font-mono text-[10px] leading-4 text-zinc-400">
            Nothing answering on the image endpoint. Start the Sync tunnel, point at Spark LAN, or open Endpoint settings.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" className="btn-primary h-7 px-2 text-[10px]" onClick={() => void startTunnelAction()}>
              Start tunnel
            </button>
            <button type="button" className="btn-ghost h-7 px-2 text-[10px]" onClick={applySparkLan}>
              Use LAN
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

      {proxyOnUpstreamDown ? (
        <p className="mb-2 max-w-3xl font-mono text-[10px] text-amber-300/90">
          Via proxy is on but the upstream is down — turn Via proxy off (Endpoint) or start the bridge; Electron prefers raw :7860.
        </p>
      ) : null}

      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 font-mono text-[10px] uppercase text-muted">Models</span>
        <button type="button" className={chipOn(resolvedImageModel === UNCENSORED_IMAGE_MODEL)} onClick={applyQuality} title={UNCENSORED_IMAGE_MODEL}>
          Quality
        </button>
        <button type="button" className={chipOn(resolvedImageModel === FAST_IMAGE_MODEL, { muted: !modelAvailable(FAST_IMAGE_MODEL) })} onClick={applyFast} title={modelAvailable(FAST_IMAGE_MODEL) ? FAST_IMAGE_MODEL : `${FAST_IMAGE_MODEL} (weights missing)`} aria-disabled={!modelAvailable(FAST_IMAGE_MODEL)}>
          Fast
        </button>
        <button type="button" className={chipOn(resolvedImageModel === DRAFT_IMAGE_MODEL, { muted: !modelAvailable(DRAFT_IMAGE_MODEL) })} onClick={applyDraft} title={modelAvailable(DRAFT_IMAGE_MODEL) ? DRAFT_IMAGE_MODEL : `${DRAFT_IMAGE_MODEL} (weights missing)`} aria-disabled={!modelAvailable(DRAFT_IMAGE_MODEL)}>
          Draft
        </button>
        <button type="button" className={chipOn(resolvedImageModel === QWEN_IMAGE_MODEL, { muted: !modelAvailable(QWEN_IMAGE_MODEL) })} onClick={applyInstruction} title={modelAvailable(QWEN_IMAGE_MODEL) ? QWEN_IMAGE_MODEL : `${QWEN_IMAGE_MODEL} (weights missing)`} aria-disabled={!modelAvailable(QWEN_IMAGE_MODEL)}>
          Instruction
        </button>
        <button type="button" className={chipOn(resolvedImageModel === QWEN_EDIT_IMAGE_MODEL, { muted: !modelAvailable(QWEN_EDIT_IMAGE_MODEL) })} onClick={applyEdit} title={modelAvailable(QWEN_EDIT_IMAGE_MODEL) ? QWEN_EDIT_IMAGE_MODEL : `${QWEN_EDIT_IMAGE_MODEL} (weights missing)`} aria-disabled={!modelAvailable(QWEN_EDIT_IMAGE_MODEL)}>
          Edit
        </button>
        <button type="button" className={chipOn(resolvedImageModel === KLEIN_IMAGE_MODEL, { muted: !modelAvailable(KLEIN_IMAGE_MODEL) })} onClick={applyKlein} title={modelAvailable(KLEIN_IMAGE_MODEL) ? KLEIN_IMAGE_MODEL : `${KLEIN_IMAGE_MODEL} (gated / weights missing)`} aria-disabled={!modelAvailable(KLEIN_IMAGE_MODEL)}>
          Klein
        </button>
        <button
          type="button"
          className={chipOn(resolvedImageModel === ANIME_IMAGE_MODEL || resolvedImageModel === PONY_IMAGE_MODEL, { muted: !(modelAvailable(ANIME_IMAGE_MODEL) || modelAvailable(PONY_IMAGE_MODEL)) })}
          onClick={applyAnime}
          title={(modelAvailable(ANIME_IMAGE_MODEL) || modelAvailable(PONY_IMAGE_MODEL)) ? `${ANIME_IMAGE_MODEL} / ${PONY_IMAGE_MODEL}` : 'Anime zoo weights missing'}
          aria-disabled={!(modelAvailable(ANIME_IMAGE_MODEL) || modelAvailable(PONY_IMAGE_MODEL))}
        >
          Anime
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 font-mono text-[10px] uppercase text-muted">Connection</span>
        <button type="button" className="chip hover:border-sky-500/40 hover:text-sky-200" onClick={applySparkLan}>
          Use Spark LAN
        </button>
        <button
          type="button"
          className={chipOn(settings.inferenceProvider === 'dgx-spark' && settings.sparkModel === SPARK_CHAT_MODEL)}
          onClick={applySparkQwen}
          title={SPARK_CHAT_MODEL}
        >
          Qwen chat
        </button>
        <button type="button" className="chip hover:border-sky-500/40 hover:text-sky-200" onClick={openBridge}>
          Open bridge
        </button>
        <button type="button" disabled={busy} className="chip hover:border-sky-500/40 hover:text-sky-200" onClick={() => void testEndpoint()}>
          Test
        </button>
        {bridgeOffline ? (
          <>
            <button type="button" className="chip hover:border-amber-500/40 hover:text-amber-200" onClick={() => void startTunnelAction()}>
              Start tunnel
            </button>
            <button type="button" className="chip hover:border-amber-500/40 hover:text-amber-200" onClick={() => void copyStartCommand()}>
              Copy start
            </button>
          </>
        ) : null}
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

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-3">
          <div className="section-card" ref={generateCardRef}>
            <div className="section-card-title">Generate</div>
            <div className="section-card-body">
              {isEditPath ? (
                <div>
                  <div className="mb-1 font-mono text-[10px] uppercase text-muted">Reference image</div>
                  <input
                    ref={refFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void loadRefFile(e.target.files?.[0])}
                  />
                  <div
                    role="button"
                    tabIndex={0}
                    className={cn(
                      'flex min-h-[7rem] cursor-pointer flex-col items-center justify-center gap-2 rounded border border-dashed px-3 py-3 text-center transition-colors',
                      refDragOver ? 'border-sky-500/70 bg-sky-950/30' : 'border-border bg-background/40',
                      refImagePreview ? 'border-emerald-700/50' : '',
                    )}
                    onClick={() => refFileInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        refFileInputRef.current?.click();
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setRefDragOver(true);
                    }}
                    onDragLeave={() => setRefDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setRefDragOver(false);
                      void loadRefFile(e.dataTransfer.files?.[0]);
                    }}
                  >
                    {refImagePreview ? (
                      <div className="flex w-full flex-col items-center gap-2">
                        <img src={refImagePreview} alt="reference" className="max-h-36 rounded object-contain" />
                        <div className="flex flex-wrap justify-center gap-1.5">
                          <button
                            type="button"
                            className="chip text-[9px]"
                            onClick={(e) => {
                              e.stopPropagation();
                              refFileInputRef.current?.click();
                            }}
                          >
                            <Upload size={10} /> Replace
                          </button>
                          <button
                            type="button"
                            className="chip text-[9px] text-red-300/90"
                            onClick={(e) => {
                              e.stopPropagation();
                              clearRefImage();
                            }}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <ImagePlus size={18} className="text-zinc-500" />
                        <span className="font-mono text-[10px] text-zinc-400">Drop an image or click to choose — required for Edit</span>
                      </>
                    )}
                  </div>
                </div>
              ) : null}

              <label className="block font-mono text-[10px] uppercase text-muted">
                <span className="flex items-center justify-between gap-2">
                  {isEditPath ? 'Edit instruction' : 'Prompt'}
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
                  placeholder={isEditPath ? 'Describe the edit… (↑/↓ history)' : 'Describe the image… (↑/↓ history)'}
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

              {!isEditPath ? (
                <div>
                  <div className="mb-1 font-mono text-[10px] uppercase text-muted">Size</div>
                  <div className="flex flex-wrap gap-1">
                    {SIZES.map((s) => (
                      <button key={s.id} type="button" className={chipOn(size === s.id)} aria-pressed={size === s.id} onClick={() => setSize(s.id)}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mb-1 font-mono text-[10px] uppercase text-muted">Output size</div>
                  <div className="flex flex-wrap gap-1">
                    {SIZES.map((s) => (
                      <button key={s.id} type="button" className={chipOn(size === s.id)} aria-pressed={size === s.id} onClick={() => setSize(s.id)}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

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

              <label className="block font-mono text-[10px] uppercase text-muted">
                Model
                <select ref={modelSelectRef} value={modelSelectValue} onChange={(e) => { const v = e.target.value; if (v === MODEL_CUSTOM) { if (knownModelIds.includes(settings.imageModel)) patch({ imageModel: '' }); return; } patch({ imageModel: v }); }} className="field mt-1">
                  {IMAGE_MODEL_OPTIONS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                  <option value={MODEL_CUSTOM}>Custom…</option>
                </select>
              </label>
              {showCustomModel ? (
                <label className="block font-mono text-[10px] uppercase text-muted">
                  Custom model id
                  <input value={settings.imageModel} onChange={(e) => patch({ imageModel: e.target.value })} className="field mt-1" placeholder="model id" />
                </label>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy || !prompt.trim() || (isEditPath && !refImageB64)}
                  onClick={() => void generate()}
                  className="btn-primary"
                  title={isEditPath && !refImageB64 ? 'Add a reference image first' : undefined}
                >
                  {busy ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 size={12} className="spin-slow" /> Generating…
                      {progress != null ? ` ${progressLabel}` : ''}
                    </span>
                  ) : isEditPath ? (
                    'Edit'
                  ) : (
                    'Generate'
                  )}
                </button>
                {busy ? (
                  <button type="button" onClick={cancelGenerate} className="btn-danger">Stop</button>
                ) : (
                  <button type="button" disabled={busy} onClick={() => void testEndpoint()} className="btn-ghost">Test</button>
                )}
                {busy ? <span className="status-badge status-badge--busy">Generating… {progressLabel || ''}</span> : null}
                {progressFailed && !busy ? <span className="status-badge status-badge--err">Failed</span> : null}
              </div>
              {progress != null ? (
                <div className="image-progress" aria-live="polite">
                  <div className="image-progress-track">
                    <div className={`image-progress-fill${progressFailed ? ' image-progress-fill--err' : ''}`} style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
                  </div>
                  <div className="image-progress-label">{progressFailed ? (busy ? 'Stopping…' : 'Generation failed') : `Progress ${progressLabel}`}</div>
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
                <p className="section-card-hint">Connection only — URL, token, and via-proxy. Sampler / Build D lives under Recipe.</p>
                <div className="section-card-body">
                  <div className="switch-row">
                    <label className="switch-row-main">
                      <span>Enabled</span>
                      <input type="checkbox" checked={settings.imageGenEnabled} onChange={(e) => patch({ imageGenEnabled: e.target.checked })} />
                    </label>
                  </div>
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

