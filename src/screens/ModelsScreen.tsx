import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { resolveActiveSettings } from '../lib/activeEndpoint';
import { endpointUrl, formatFetchError } from '../lib/apiUrl';
import { coalesceFetch } from '../lib/coalesceFetch';
import { cn } from '../lib/cn';
import { setSettings } from '../lib/storage';
import type { ClientSettings } from '../types';

interface Props {
  settings: ClientSettings;
  onSettingsChange: (s: ClientSettings) => void;
}

interface ModelItem {
  id: string;
  owned_by?: string;
  created?: number;
  popularity?: number;
  status?: string;
  available?: boolean;
  available_on_current_plan?: boolean;
  training?: string;
  name?: string;
}

type SortMode = 'ranking' | 'name';

const ABLIT_RE = /abliterat|obliterat/i;
const PER_PAGE = 100;

function isAbliteratedModel(m: ModelItem): boolean {
  if (typeof m.training === 'string' && ABLIT_RE.test(m.training)) return true;
  if (ABLIT_RE.test(m.id || '')) return true;
  if (ABLIT_RE.test(m.owned_by || '')) return true;
  if (typeof m.name === 'string' && ABLIT_RE.test(m.name)) return true;
  return false;
}

function normalizeModel(raw: Record<string, unknown>): ModelItem | null {
  const id = raw.id;
  if (typeof id !== 'string' || !id) return null;
  const out: ModelItem = { id };
  if (typeof raw.owned_by === 'string') out.owned_by = raw.owned_by;
  if (typeof raw.created === 'number') out.created = raw.created;
  if (typeof raw.popularity === 'number') out.popularity = raw.popularity;
  if (typeof raw.status === 'string') out.status = raw.status;
  if (typeof raw.available === 'boolean') out.available = raw.available;
  if (typeof raw.available_on_current_plan === 'boolean') {
    out.available_on_current_plan = raw.available_on_current_plan;
  }
  if (typeof raw.training === 'string') out.training = raw.training;
  if (typeof raw.name === 'string') out.name = raw.name;
  return out;
}

function appendQuery(url: string, params: URLSearchParams): string {
  const qs = params.toString();
  if (!qs) return url;
  return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
}

export function ModelsScreen({ settings, onSettingsChange }: Props) {
  const active = resolveActiveSettings(settings);
  const isFeatherless = settings.inferenceProvider === 'featherless';

  const [models, setModels] = useState<ModelItem[]>([
    { id: active.defaultModel || 'abliterated-model', owned_by: 'local' },
  ]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [abliteratedOnly, setAbliteratedOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('ranking');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const selectedId =
    settings.inferenceProvider === 'dgx-spark'
      ? settings.sparkModel
      : settings.inferenceProvider === 'featherless'
        ? settings.featherlessModel
        : settings.defaultModel;

  const load = useCallback(
    async (opts?: { page?: number; append?: boolean }) => {
      const pageNum = opts?.page ?? 1;
      const append = opts?.append === true;
      setError('');
      const resolved = resolveActiveSettings(settings);

      if (settings.inferenceProvider === 'dgx-spark' && !settings.sparkEnabled) {
        setError('DGX Spark selected but Spark endpoint is not marked available.');
        setModels([{ id: resolved.defaultModel || 'qwen-abliterated', owned_by: 'inactive' }]);
        setHasMore(false);
        return;
      }
      if (settings.inferenceProvider === 'featherless' && settings.featherlessEnabled === false) {
        setError('Featherless selected but endpoint is not marked available.');
        setModels([{ id: resolved.defaultModel || 'Qwen/Qwen2.5-7B-Instruct', owned_by: 'inactive' }]);
        setHasMore(false);
        return;
      }
      const provider = settings.inferenceProvider ?? 'abliteration';
      const needsRemoteToggle = provider === 'abliteration' || provider === 'custom';
      if (!resolved.baseUrl.trim() || (needsRemoteToggle && !settings.remoteHostEnabled)) {
        setModels([{ id: resolved.defaultModel || 'abliterated-model', owned_by: 'local' }]);
        setHasMore(false);
        return;
      }

      setLoading(true);
      try {
        const headers: Record<string, string> = { 'X-Retention': 'none' };
        if (resolved.token.trim()) headers.Authorization = 'Bearer ' + resolved.token.trim();
        if (resolved.provider === 'featherless') {
          headers['HTTP-Referer'] = 'http://localhost:5173';
          headers['X-Title'] = 'ablit';
        }

        const base = endpointUrl(
          {
            baseUrl: resolved.baseUrl,
            sparkViaProxy: resolved.sparkViaProxy,
            featherlessViaProxy: resolved.featherlessViaProxy,
            inferenceProvider: resolved.provider,
          },
          '/models',
        );

        let url = base;
        if (resolved.provider === 'featherless') {
          const params = new URLSearchParams();
          params.set('per_page', String(PER_PAGE));
          params.set('page', String(pageNum));
          if (sortMode === 'ranking') params.set('sort', '-popularity');
          const q = debouncedQuery.trim();
          if (q) params.set('q', q);
          if (activeOnly) params.set('available_on_current_plan', 'true');
          if (abliteratedOnly) params.set('training', 'abliterated');
          url = appendQuery(base, params);
        }

        const res = await coalesceFetch(url, { headers });
        if (!res.ok) {
          if (res.status === 429) {
            throw new Error('HTTP 429 — rate limited; wait a few seconds before refreshing models');
          }
          const localFeather =
            resolved.provider === 'featherless' &&
            (resolved.baseUrl.includes('127.0.0.1:3000') || resolved.baseUrl.includes('localhost:3000'));
          if (res.status === 502 && localFeather) {
            throw new Error(
              'Featherless local proxy not running on :3000 — start it, or set base URL to https://api.featherless.ai/v1 + API key',
            );
          }
          if (res.status === 502 && resolved.provider === 'featherless') {
            throw new Error(
              'Featherless request failed (502). Prefer https://api.featherless.ai/v1 + API key, or start the local :3000 proxy.',
            );
          }
          throw new Error('HTTP ' + String(res.status));
        }

        const json = (await res.json()) as { data?: unknown[] } | unknown[];
        const rawList = Array.isArray(json) ? json : Array.isArray(json.data) ? json.data : [];
        const list = rawList
          .map((item) =>
            item && typeof item === 'object' ? normalizeModel(item as Record<string, unknown>) : null,
          )
          .filter((m): m is ModelItem => m != null);

        const next = list.length ? list : [{ id: resolved.defaultModel || 'abliterated-model' }];
        setPage(pageNum);
        setHasMore(resolved.provider === 'featherless' && list.length >= PER_PAGE);
        setModels((prev) => {
          if (!append) return next;
          const seen = new Set(prev.map((m) => m.id));
          const merged = [...prev];
          for (const m of next) {
            if (!seen.has(m.id)) {
              seen.add(m.id);
              merged.push(m);
            }
          }
          return merged;
        });
      } catch (err) {
        setError(formatFetchError(err));
        if (!append) {
          setModels([{ id: resolved.defaultModel || 'abliterated-model', owned_by: 'local' }]);
          setHasMore(false);
        }
      } finally {
        setLoading(false);
      }
    },
    [settings, sortMode, debouncedQuery, activeOnly, abliteratedOnly],
  );

  useEffect(() => {
    void load({ page: 1, append: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.baseUrl,
    settings.token,
    settings.remoteHostEnabled,
    settings.inferenceProvider,
    settings.sparkEnabled,
    settings.sparkBaseUrl,
    settings.sparkToken,
    settings.sparkViaProxy,
    settings.featherlessEnabled,
    settings.featherlessBaseUrl,
    settings.featherlessToken,
    settings.featherlessViaProxy,
    isFeatherless ? sortMode : null,
    isFeatherless ? debouncedQuery : null,
    isFeatherless ? activeOnly : null,
    isFeatherless ? abliteratedOnly : null,
  ]);

  const select = (id: string) => {
    const next =
      settings.inferenceProvider === 'dgx-spark'
        ? { ...settings, sparkModel: id }
        : settings.inferenceProvider === 'featherless'
          ? { ...settings, featherlessModel: id }
          : { ...settings, defaultModel: id };
    setSettings(next);
    onSettingsChange(next);
  };

  const filtered = useMemo(() => {
    let list = models.slice();

    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((m) => {
        const id = (m.id || '').toLowerCase();
        const owner = (m.owned_by || '').toLowerCase();
        const name = (m.name || '').toLowerCase();
        return id.includes(q) || owner.includes(q) || name.includes(q);
      });
    }

    if (abliteratedOnly) {
      list = list.filter(isAbliteratedModel);
    }

    if (activeOnly && !isFeatherless) {
      const hasHints = models.some(
        (m) => m.status != null || m.available != null || m.available_on_current_plan != null,
      );
      list = list.filter((m) => {
        if (m.id === selectedId) return true;
        if (!hasHints) return false;
        return (
          m.status === 'active' ||
          m.available === true ||
          m.available_on_current_plan === true
        );
      });
    } else if (activeOnly && isFeatherless) {
      list = list.filter((m) => m.available_on_current_plan !== false);
    }

    if (sortMode === 'name') {
      list.sort((a, b) => a.id.localeCompare(b.id, undefined, { sensitivity: 'base' }));
    } else if (!isFeatherless) {
      const hasCreated = list.some((m) => typeof m.created === 'number');
      if (hasCreated) {
        list.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
      }
    }

    if (selectedId) {
      const idx = list.findIndex((m) => m.id === selectedId);
      if (idx > 0) {
        const [sel] = list.splice(idx, 1);
        list.unshift(sel);
      }
    }

    return list;
  }, [models, query, abliteratedOnly, activeOnly, isFeatherless, sortMode, selectedId]);

  const toggleChip = (on: boolean) =>
    cn(
      'chip',
      on && 'border-emerald-700/80 bg-emerald-950/50 text-emerald-300 hover:border-emerald-600 hover:text-emerald-200',
    );

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="font-mono text-xs font-semibold tracking-wide text-zinc-200">
          MODELS <span className="text-muted">({active.label})</span>
        </div>
        <button
          type="button"
          onClick={() => void load({ page: 1, append: false })}
          className="rounded border border-border px-2 py-1 font-mono text-[10px] text-zinc-300"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className="relative mb-2">
        <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search models by id or owner…"
          autoComplete="off"
          spellCheck={false}
          className="field w-full pl-7"
          aria-label="Search models"
        />
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-pressed={activeOnly}
          onClick={() => setActiveOnly((v) => !v)}
          className={toggleChip(activeOnly)}
          title={
            isFeatherless
              ? 'Filter to models available on your current Featherless plan'
              : 'Show currently selected / active models only'
          }
        >
          Active
        </button>
        <button
          type="button"
          aria-pressed={abliteratedOnly}
          onClick={() => setAbliteratedOnly((v) => !v)}
          className={toggleChip(abliteratedOnly)}
          title="Filter to abliterated / obliterated models"
        >
          Abliterated
        </button>
        <span className="mx-0.5 text-muted">|</span>
        <button
          type="button"
          aria-pressed={sortMode === 'ranking'}
          onClick={() => setSortMode('ranking')}
          className={toggleChip(sortMode === 'ranking')}
          title={isFeatherless ? 'Sort by popularity (API)' : 'Sort by created / API order'}
        >
          Ranking
        </button>
        <button
          type="button"
          aria-pressed={sortMode === 'name'}
          onClick={() => setSortMode('name')}
          className={toggleChip(sortMode === 'name')}
          title="Sort by model id A–Z"
        >
          Name A–Z
        </button>
      </div>

      {error ? <div className="mb-2 font-mono text-[11px] text-red-400">{error}</div> : null}

      <div className="mb-2 font-mono text-[10px] text-muted">
        Showing {filtered.length} of {models.length}
        {query.trim() ? ` · filter "${query.trim()}"` : ''}
        {activeOnly ? ' · active' : ''}
        {abliteratedOnly ? ' · abliterated' : ''}
      </div>

      <ul className="divide-y divide-border rounded border border-border">
        {filtered.length === 0 ? (
          <li className="px-3 py-6 text-center font-mono text-[11px] text-muted">
            No models match{query.trim() ? ` "${query.trim()}"` : ''}.
            {query.trim() || activeOnly || abliteratedOnly ? (
              <button
                type="button"
                className="ml-2 text-zinc-300 underline hover:text-zinc-100"
                onClick={() => {
                  setQuery('');
                  setActiveOnly(false);
                  setAbliteratedOnly(false);
                }}
              >
                Clear
              </button>
            ) : null}
          </li>
        ) : (
          filtered.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => select(m.id)}
                className={cn(
                  'flex w-full items-center justify-between px-3 py-2 text-left font-mono text-xs hover:bg-zinc-900',
                  selectedId === m.id && 'bg-zinc-900 text-emerald-300',
                )}
              >
                <span className="min-w-0 truncate pr-2">{m.id}</span>
                <span className="shrink-0 text-[10px] text-muted">
                  {isAbliteratedModel(m) ? 'ablit · ' : ''}
                  {m.owned_by || 'remote'}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>

      {hasMore ? (
        <div className="mt-2 flex justify-center">
          <button
            type="button"
            disabled={loading}
            onClick={() => void load({ page: page + 1, append: true })}
            className="rounded border border-border px-3 py-1 font-mono text-[10px] text-zinc-300 hover:border-zinc-600 disabled:opacity-40"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      ) : null}

      <div className="mt-3 font-mono text-[10px] text-muted">Default: {selectedId}</div>
    </div>
  );
}
