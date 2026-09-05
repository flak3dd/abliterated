import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Download, Eye, ImageIcon, Loader2, Maximize2, Trash2, X } from 'lucide-react';
import { generateImage, imageEndpointUrl } from '../lib/imageGen';
import {
  IMAGE_LIBRARY_MAX,
  deleteLibraryImage,
  estimateImageProgress,
  getLibraryImageDataUrl,
  listLibraryImages,
  saveGeneratedImage,
  type StoredImageMeta,
} from '../lib/imageLibrary';
import { setSettings } from '../lib/storage';
import type { ClientSettings } from '../types';

interface Props {
  settings: ClientSettings;
  onSettingsChange: (s: ClientSettings) => void;
}

const SIZES = ['1024x1024', '768x768', '512x512'] as const;

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

export function ImagesScreen({ settings, onSettingsChange }: Props) {
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<(typeof SIZES)[number]>('1024x1024');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorOpen, setErrorOpen] = useState(false);
  const [b64, setB64] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [testNote, setTestNote] = useState('');
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [testDetailOpen, setTestDetailOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; prompt: string } | null>(null);

  const [progress, setProgress] = useState<number | null>(null);
  const [progressEst, setProgressEst] = useState(true);
  const [progressFailed, setProgressFailed] = useState(false);

  const [library, setLibrary] = useState<StoredImageMeta[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [libraryNote, setLibraryNote] = useState('');
  const thumbCache = useRef<Record<string, string>>({});
  const progressEstRef = useRef(true);

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
    try {
      const entries = await listLibraryImages();
      setLibrary(entries);
      const nextThumbs: Record<string, string> = { ...thumbCache.current };
      await Promise.all(
        entries.slice(0, 24).map(async (e) => {
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
    }
  }, []);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  const persistResult = async (result: { b64?: string; url?: string }, p: string, sz: string) => {
    if (!result.b64 && !result.url) return;
    try {
      await saveGeneratedImage({
        prompt: p,
        size: sz,
        model: settings.imageModel || 'abliterated-flux-klein',
        b64: result.b64,
        url: result.url,
      });
      await refreshLibrary();
    } catch (err) {
      console.warn('saveGeneratedImage failed', err);
      setLibraryNote(err instanceof Error ? err.message : String(err));
    }
  };

  const generate = async () => {
    const p = prompt.trim();
    if (!p || busy) return;
    setBusy(true);
    setError('');
    setErrorOpen(false);
    setB64(null);
    setRemoteUrl(null);
    setProgress(0);
    setProgressEst(true);
    progressEstRef.current = true;
    setProgressFailed(false);

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
      const result = await generateImage({
        settings,
        prompt: p,
        size,
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
      if (!result.b64 && !result.url) {
        setError('Empty image payload');
        setErrorOpen(true);
        setProgressFailed(true);
      } else {
        await persistResult(result, p, size);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setErrorOpen(true);
      setProgressFailed(true);
    } finally {
      window.clearInterval(tick);
      setBusy(false);
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

  const removeLibraryEntry = async (entry: StoredImageMeta) => {
    try {
      await deleteLibraryImage(entry);
      delete thumbCache.current[entry.id];
      setThumbUrls((t) => {
        const next = { ...t };
        delete next[entry.id];
        return next;
      });
      await refreshLibrary();
    } catch (err) {
      setLibraryNote(err instanceof Error ? err.message : String(err));
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
      if (result.b64 || result.url) {
        await persistResult(result, 'tiny red square test', '512x512');
      }
    } catch (err) {
      setTestNote(err instanceof Error ? err.message : String(err));
      setTestOk(false);
      setTestDetailOpen(true);
      setProgressFailed(true);
    } finally {
      window.clearInterval(tick);
      setBusy(false);
      window.setTimeout(() => {
        setProgress(null);
        setProgressFailed(false);
      }, 700);
    }
  };

  const progressLabel =
    progress == null
      ? null
      : progressFailed
        ? 'Failed'
        : progress >= 100
          ? '100%'
          : progressEst
            ? `~${progress}% (est.)`
            : `${progress}%`;

  if (!settings.imageGenEnabled) {
    return (
      <div className="h-full overflow-auto p-4">
        <header className="page-header">
          <div className="flex items-center gap-2 page-header-title">
            <ImageIcon size={14} /> Images
          </div>
          <p className="page-header-sub">Local OpenAI-compatible image generation (not cloud).</p>
        </header>

        <div className="section-card max-w-xl">
          <div className="section-card-title text-amber-300">Image generation disabled</div>
          <p className="section-card-hint mt-2">
            api.abliteration.ai has no <code className="text-zinc-400">/v1/images/generations</code> — cloud chat
            supports multimodal <em>input</em> only. Run a local OpenAI-compatible server (abliterated FLUX.2 Klein in{' '}
            <code className="text-zinc-400">spark-image/</code>).
          </p>
          <div className="section-card-body">
            <button type="button" onClick={() => patch({ imageGenEnabled: true })} className="btn-primary w-fit">
              Enable image generator
            </button>
            <p className="font-mono text-[11px] text-muted">
              No GPU? Secondary tip:{' '}
              <code className="text-zinc-300">npm run image:mock</code> or set up{' '}
              <code className="text-zinc-300">spark-image/</code>. A blank HTTP 500 usually means nothing is listening
              on :7860.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4">
      <header className="page-header">
        <div className="flex items-center gap-2 page-header-title">
          <ImageIcon size={14} /> Images
        </div>
        <p className="page-header-sub">Prompt to local endpoint to preview. Cmd/Ctrl+Enter to generate.</p>
      </header>

      <div className="grid max-w-4xl gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div className="section-card">
            <div className="section-card-title">Generate</div>
            <div className="section-card-body">
              <label className="block font-mono text-[10px] uppercase text-muted">
                Prompt
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={onPromptKeyDown}
                  rows={4}
                  className="field mt-1 resize-y"
                  placeholder="Describe the image…"
                />
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {PROMPT_SUGGESTIONS.map((sug, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPrompt(sug)}
                      className="chip text-[9px] hover:border-sky-500/40 hover:text-sky-200"
                    >
                      {sug}
                    </button>
                  ))}
                </div>
              </label>
              <label className="block font-mono text-[10px] uppercase text-muted">
                Size
                <select
                  value={size}
                  onChange={(e) => setSize(e.target.value as (typeof SIZES)[number])}
                  className="field mt-1"
                >
                  {SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy || !prompt.trim()}
                  onClick={() => void generate()}
                  className="btn-primary"
                >
                  {busy ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 size={12} className="spin-slow" /> Generating…
                      {progress != null ? ` ${progressLabel}` : ''}
                    </span>
                  ) : (
                    'Generate'
                  )}
                </button>
                <button type="button" disabled={busy} onClick={() => void testEndpoint()} className="btn-ghost">
                  Test
                </button>
                {busy ? (
                  <span className="status-badge status-badge--busy">
                    Generating… {progressLabel || ''}
                  </span>
                ) : null}
                {progressFailed ? <span className="status-badge status-badge--err">Failed</span> : null}
              </div>
              {progress != null ? (
                <div className="image-progress" aria-live="polite">
                  <div className="image-progress-track">
                    <div
                      className={`image-progress-fill${progressFailed ? ' image-progress-fill--err' : ''}`}
                      style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                    />
                  </div>
                  <div className="image-progress-label">
                    {progressFailed ? 'Generation failed' : `Progress ${progressLabel}`}
                  </div>
                </div>
              ) : null}
              {error ? (
                <div>
                  <button
                    type="button"
                    className="status-badge status-badge--err"
                    onClick={() => setErrorOpen((o) => !o)}
                  >
                    Error — {errorOpen ? 'hide' : 'details'}
                  </button>
                  {errorOpen ? (
                    <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-red-400">{error}</pre>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="section-card">
            <div className="section-card-title">Endpoint</div>
            <p className="section-card-hint">Local OpenAI-compatible image API settings.</p>
            <div className="section-card-body">
              <div className="switch-row">
                <label className="switch-row-main">
                  <span>Enabled</span>
                  <input
                    type="checkbox"
                    checked={settings.imageGenEnabled}
                    onChange={(e) => patch({ imageGenEnabled: e.target.checked })}
                  />
                </label>
              </div>
              <label className="block font-mono text-[10px] uppercase text-muted">
                Base URL
                <input
                  value={settings.imageBaseUrl}
                  onChange={(e) => patch({ imageBaseUrl: e.target.value })}
                  className="field mt-1"
                />
              </label>
              <label className="block font-mono text-[10px] uppercase text-muted">
                Model
                <input
                  value={settings.imageModel}
                  onChange={(e) => patch({ imageModel: e.target.value })}
                  className="field mt-1"
                />
              </label>
              <label className="block font-mono text-[10px] uppercase text-muted">
                Token
                <input
                  type="password"
                  value={settings.imageToken}
                  onChange={(e) => patch({ imageToken: e.target.value })}
                  className="field mt-1"
                  placeholder="••••••••"
                  autoComplete="off"
                />
              </label>
              <div className="switch-row">
                <label className="switch-row-main">
                  <span>Via Vite proxy (/image-v1)</span>
                  <input
                    type="checkbox"
                    checked={settings.imageViaProxy !== false}
                    onChange={(e) => patch({ imageViaProxy: e.target.checked })}
                  />
                </label>
                <p className="switch-row-help">DEV same-origin rewrite for local image servers.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="truncate font-mono text-[10px] text-zinc-500">
                  POST {imageEndpointUrl(settings, '/images/generations')}
                </div>
                {testOk === true ? <span className="status-badge status-badge--ok">ok</span> : null}
                {testOk === false ? (
                  <button
                    type="button"
                    className="status-badge status-badge--err"
                    onClick={() => setTestDetailOpen((o) => !o)}
                  >
                    unreachable
                  </button>
                ) : null}
              </div>
              {testNote && (testDetailOpen || testOk === true) ? (
                <pre className="whitespace-pre-wrap font-mono text-[10px] text-zinc-400">{testNote}</pre>
              ) : null}
              {testOk === false && !testDetailOpen ? (
                <button
                  type="button"
                  className="font-mono text-[10px] text-zinc-500 underline hover:text-zinc-300"
                  onClick={() => setTestDetailOpen(true)}
                >
                  Show error details
                </button>
              ) : null}
            </div>
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
                {progress != null ? (
                  <div className="image-progress w-48">
                    <div className="image-progress-track">
                      <div
                        className={`image-progress-fill${progressFailed ? ' image-progress-fill--err' : ''}`}
                        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : previewSrc ? (
              <div
                onClick={() => setLightboxImage({ src: previewSrc, prompt: prompt || 'Generated image' })}
                className="group relative cursor-zoom-in max-h-[70vh] w-full flex items-center justify-center rounded overflow-hidden"
              >
                <img src={previewSrc} alt="generated" className="max-h-[70vh] w-full rounded object-contain" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-zinc-100 font-mono text-xs">
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

      <div className="section-card mt-4 max-w-4xl">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="section-card-title">Library</div>
            <p className="section-card-hint">
              Saved under <code className="text-zinc-400">.ablit/images/</code> when the bridge is connected; otherwise
              IndexedDB. Keeps last {IMAGE_LIBRARY_MAX}.
            </p>
          </div>
          <button type="button" className="btn-ghost h-7 px-2 text-[10px]" onClick={() => void refreshLibrary()}>
            Refresh
          </button>
        </div>
        {libraryNote ? (
          <pre className="mb-2 whitespace-pre-wrap font-mono text-[10px] text-amber-300/90">{libraryNote}</pre>
        ) : null}
        {library.length === 0 ? (
          <div className="image-empty min-h-[8rem]">
            <span>No saved images yet</span>
          </div>
        ) : (
          <div className="image-library-grid">
            {library.map((entry) => {
              const thumb = thumbUrls[entry.id];
              return (
                <div key={entry.id} className="image-library-card">
                  <button
                    type="button"
                    className="image-library-thumb"
                    onClick={() => {
                      const src = thumbUrls[entry.id];
                      if (src) setLightboxImage({ src, prompt: entry.prompt });
                      else void openLibraryEntry(entry);
                    }}
                    title={entry.prompt}
                  >
                    {thumb ? (
                      <img src={thumb} alt="" />
                    ) : (
                      <span className="font-mono text-[10px] text-zinc-600">…</span>
                    )}
                  </button>
                  <div className="image-library-meta">
                    <div className="image-library-prompt" title={entry.prompt}>
                      {entry.prompt || '(no prompt)'}
                    </div>
                    <div className="image-library-sub">
                      {formatWhen(entry.createdAt)} · {entry.size} · {entry.storage}
                    </div>
                    <div className="image-library-actions">
                      <button
                        type="button"
                        className="btn-ghost h-6 px-1.5 text-[10px]"
                        onClick={() => {
                          const src = thumbUrls[entry.id];
                          if (src) setLightboxImage({ src, prompt: entry.prompt });
                          else void openLibraryEntry(entry);
                        }}
                      >
                        <Eye size={10} /> View
                      </button>
                      <button
                        type="button"
                        className="btn-ghost h-6 px-1.5 text-[10px]"
                        onClick={() => {
                          const src = thumbUrls[entry.id];
                          if (src) download(src, `${entry.id}.png`);
                          else void getLibraryImageDataUrl(entry).then((u) => u && download(u, `${entry.id}.png`));
                        }}
                      >
                        <Download size={10} />
                      </button>
                      <button
                        type="button"
                        className="btn-ghost h-6 px-1.5 text-[10px] text-red-300/90"
                        onClick={() => void removeLibraryEntry(entry)}
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Lightbox Zoom Modal */}
      {lightboxImage ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 modal-animate-in"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="relative max-w-5xl max-h-[90vh] flex flex-col rounded-lg border border-border bg-surface overflow-hidden shadow-2xl shadow-black"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-surface-raised font-mono text-xs">
              <span className="truncate max-w-md text-zinc-200">{lightboxImage.prompt}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => download(lightboxImage.src, 'image.png')}
                  className="btn-ghost h-6 px-2 text-[10px]"
                >
                  <Download size={11} /> Download
                </button>
                <button
                  type="button"
                  onClick={() => setLightboxImage(null)}
                  className="rounded p-1 text-zinc-400 hover:text-zinc-100"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="p-2 flex items-center justify-center bg-black/90 overflow-auto">
              <img src={lightboxImage.src} alt="full-size" className="max-h-[78vh] object-contain rounded" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
