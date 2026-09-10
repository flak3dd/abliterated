import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  applyInferenceProvider,
  INFERENCE_PROVIDERS,
  missingInferenceAuthError,
  resolveActiveSettings,
  isProviderConfigured,
  providerUnconfiguredReason,
} from '../lib/activeEndpoint';
import { endpointUrl, formatFetchError } from '../lib/apiUrl';
import { fetchPlatformCredentials } from '../lib/authApi';
import { coalesceFetch } from '../lib/coalesceFetch';
import { setSettings, sanitizeSettings } from '../lib/storage';
import { ModelSettingsGuidePanel } from '../components/common/ModelSettingsGuide';
import { formatFeatherlessProbeReport, probeFeatherlessChat } from '../lib/featherlessDebug';
import { extractHttpErrorMessage } from '../lib/providerError';
import {
  alignSetupForProvider,
  checkProviderAlignment,
  getProviderSetupAlignment,
} from '../lib/agentPresets';
import { recommendedApiPatch } from '../lib/modelSettingsGuide';
import {
  DRAFT_IMAGE_MODEL,
  FAST_IMAGE_MODEL,
  IMAGE_MODEL_OPTIONS,
  SPARK_CHAT_MODEL,
  UNCENSORED_IMAGE_MODEL,
  sparkBridgeDownHint,
  sparkChatSettingsPatch,
  sparkImageSettingsPatch,
  sparkImageUrl,
  sparkPushCommand,
  sparkQwenPushCommand,
} from '../lib/sparkInstall';
import { XAI_IMAGE_BASE_URL, XAI_IMAGE_MODEL, XAI_QUALITIES, isXaiImageBackend, xaiImageSettingsPatch } from '../lib/xaiImage';

import type { ClientSettings, InferenceProvider, ReasoningLevel } from '../types';
import {
  DEFAULT_FEATHERLESS_MODEL,
  FEATHERLESS_EMPTY_STATE,
  PINNED_FEATHERLESS_MODELS,
  abliterationGradeFeatherlessPatch,
  filterFeatherlessQwenModels,
  mergePinnedFeatherlessModels,
  resolveFeatherlessModelId,
} from '../lib/featherlessQwen';

interface Props {
  settings: ClientSettings;
  onSettingsChange: (s: ClientSettings) => void;
}

const REASONING: ReasoningLevel[] = ['off', 'low', 'high', 'max'];
type FeatherSession = { ok?: boolean; signedIn?: boolean; expiresAt?: string | null; scope?: string | null };

const CLOUD_FEATHERLESS_BASE = 'https://api.featherless.ai/v1';

const PROVIDER_HINT: Record<InferenceProvider, string> = {
  platform: 'Virtual key from your abliterated.app account. Routes included Featherless models.',
  abliteration: 'Cloud abliteration.ai. Paste an API token from the Abliteration console.',
  'dgx-spark': 'Local Qwen vLLM on Spark :8000. No cloud key.',
  featherless: 'Your Featherless key. Pinned Qwen / GLM chips, or any allowed model id.',
  custom: 'Any OpenAI-compatible base URL, key, and model id.',
};

function isLocalFeatherOAuthBase(baseUrl: string): boolean {
  const u = (baseUrl || '').trim().replace(/\/$/, '');
  return u === 'http://127.0.0.1:3000/v1' || u === 'http://localhost:3000/v1';
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="section-card">
      <div>
        <div className="section-card-title">{title}</div>
        {hint ? <p className="section-card-hint">{hint}</p> : null}
      </div>
      <div className="section-card-body">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{label}</span>
      {children}
      {hint ? <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">{hint}</p> : null}
    </label>
  );
}


export function ApiScreen({ settings, onSettingsChange }: Props) {
  const [draft, setDraft] = useState(settings);
  const [result, setResult] = useState('');
  const [testing, setTesting] = useState(false);
  const [featherSession, setFeatherSession] = useState<FeatherSession | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const patch = (partial: Partial<ClientSettings>) => {
    const next = sanitizeSettings({ ...draft, ...partial });
    setDraft(next);
    setSettings(next);
    onSettingsChange(next);
  };

  const authHeaders = (token: string): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Retention': 'none',
    };
    if (token.trim()) headers.Authorization = 'Bearer ' + token.trim();
    return headers;
  };

  const sparkEndpointArgs = (s: ClientSettings) => ({
    baseUrl: s.sparkBaseUrl,
    sparkViaProxy: s.sparkViaProxy,
    inferenceProvider: 'dgx-spark' as const,
  });


  const featherEndpointArgs = (s: ClientSettings) => ({
    baseUrl: s.featherlessBaseUrl,
    featherlessViaProxy: s.featherlessViaProxy,
    inferenceProvider: 'featherless' as const,
  });

  const sessionUrl = (): string => {
    if (import.meta.env.DEV) return '/featherless-oauth/session';
    return 'http://127.0.0.1:3000/session';
  };

  const refreshFeatherSession = useCallback(async () => {
    try {
      const res = await fetch(sessionUrl());
      if (!res.ok) {
        setFeatherSession({ ok: false, signedIn: false });
        return { ok: false, signedIn: false } as FeatherSession;
      }
      const json = (await res.json()) as FeatherSession;
      setFeatherSession(json);
      return json;
    } catch {
      setFeatherSession({ ok: false, signedIn: false });
      return { ok: false, signedIn: false } as FeatherSession;
    }
  }, []);

  useEffect(() => {
    if ((draft.inferenceProvider || 'abliteration') !== 'featherless') {
      if (pollRef.current != null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setFeatherSession(null);
      return;
    }
    if (!isLocalFeatherOAuthBase(draft.featherlessBaseUrl)) {
      if (pollRef.current != null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setFeatherSession(null);
      return;
    }
    void refreshFeatherSession();
    return () => {
      if (pollRef.current != null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [draft.inferenceProvider, draft.featherlessBaseUrl, refreshFeatherSession]);

  const signInFeatherless = () => {
    window.open('http://localhost:3000/login', 'featherless-oauth', 'noopener,noreferrer,width=640,height=720');
    if (pollRef.current != null) window.clearInterval(pollRef.current);
    let n = 0;
    pollRef.current = window.setInterval(() => {
      n += 1;
      void refreshFeatherSession().then((s) => {
        if (s.signedIn || n > 60) {
          if (pollRef.current != null) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      });
    }, 1500);
  };

  const logoutFeatherless = async () => {
    try {
      await fetch(import.meta.env.DEV ? '/featherless-oauth/logout' : 'http://127.0.0.1:3000/logout', {
        method: 'POST',
      });
    } catch {
      /* ignore */
    }
    await refreshFeatherSession();
  };

  const testCloudOrCustom = async () => {
    setTesting(true);
    setResult('');
    if (!draft.remoteHostEnabled || !draft.baseUrl.trim()) {
      setResult('Remote disabled or empty baseUrl — using local dummy echo.');
      setTesting(false);
      return;
    }
    const url = endpointUrl(draft, '/chat/completions');
    try {
      const post = await fetch(url, {
        method: 'POST',
        headers: authHeaders(draft.token),
        body: JSON.stringify({
          model: draft.defaultModel,
          stream: false,
          messages: [{ role: 'user', content: 'Reply with the single word pong.' }],
          max_tokens: 256,
        }),
      });
      const postText = await post.text();
      let summary = 'POST ' + url + ' ' + String(post.status);
      try {
        const json = JSON.parse(postText) as {
          model?: string;
          choices?: Array<{ finish_reason?: string; message?: { content?: string | null; reasoning?: string | null } }>;
        };
        const msg = json.choices?.[0]?.message;
        summary += '\nmodel: ' + (json.model || draft.defaultModel);
        summary += '\nfinish: ' + (json.choices?.[0]?.finish_reason || '');
        summary += '\ncontent: ' + JSON.stringify(msg?.content ?? null);
        const reasoning = msg?.reasoning || '';
        if (reasoning) summary += '\nreasoning: ' + reasoning.slice(0, 400);
      } catch {
        summary += '\n' + postText.slice(0, 500);
      }
      setResult(summary);
    } catch (err) {
      setResult(formatFetchError(err));
    } finally {
      setTesting(false);
    }
  };

  const testSpark = async () => {
    setTesting(true);
    setResult('');
    if (!draft.sparkEnabled) {
      setResult('Spark endpoint unavailable — enable "Spark endpoint available" first.');
      setTesting(false);
      return;
    }
    if (!draft.sparkBaseUrl.trim()) {
      setResult('Empty Spark base URL.');
      setTesting(false);
      return;
    }
    const url = endpointUrl(sparkEndpointArgs(draft), '/chat/completions');
    const sparkHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (draft.sparkToken.trim()) sparkHeaders.Authorization = 'Bearer ' + draft.sparkToken.trim();
    const thinkingOn = draft.reasoning !== 'off';
    try {
      const post = await fetch(url, {
        method: 'POST',
        headers: sparkHeaders,
        body: JSON.stringify({
          model: draft.sparkModel || SPARK_CHAT_MODEL,
          stream: false,
          messages: [{ role: 'user', content: 'Reply with the single word pong.' }],
          max_tokens: thinkingOn ? 512 : 64,
          chat_template_kwargs: { enable_thinking: thinkingOn },
        }),
      });
      const postText = await post.text();
      let summary = 'POST ' + url + ' ' + String(post.status);
      try {
        const json = JSON.parse(postText) as {
          model?: string;
          choices?: Array<{
            finish_reason?: string;
            message?: { content?: string | null; reasoning?: string | null; reasoning_content?: string | null };
          }>;
        };
        const msg = json.choices?.[0]?.message;
        summary += '\nmodel: ' + (json.model || draft.sparkModel);
        summary += '\nfinish: ' + (json.choices?.[0]?.finish_reason || '');
        summary += '\ncontent: ' + JSON.stringify(msg?.content ?? null);
        const reasoning = msg?.reasoning || msg?.reasoning_content || '';
        if (reasoning) summary += '\nreasoning: ' + reasoning.slice(0, 400);
      } catch {
        summary += '\n' + postText.slice(0, 500);
      }
      setResult(summary);
    } catch (err) {
      setResult(formatFetchError(err));
    } finally {
      setTesting(false);
    }
  };

  const listSparkModels = async () => {
    setTesting(true);
    setResult('');
    if (!draft.sparkEnabled) {
      setResult('Spark endpoint unavailable — enable "Spark endpoint available" first.');
      setTesting(false);
      return;
    }
    const url = endpointUrl(sparkEndpointArgs(draft), '/models');
    try {
      const headers: Record<string, string> = {};
      if (draft.sparkToken.trim()) headers.Authorization = 'Bearer ' + draft.sparkToken.trim();
      const res = await coalesceFetch(url, { headers });
      const text = await res.text();
      setResult('GET ' + url + ' ' + String(res.status) + '\n' + text.slice(0, 2000));
    } catch (err) {
      setResult(formatFetchError(err));
    } finally {
      setTesting(false);
    }
  };


  const testFeatherless = async () => {
    setTesting(true);
    setResult('');
    if (draft.featherlessEnabled === false) {
      setResult('Featherless endpoint unavailable — enable it first.');
      setTesting(false);
      return;
    }
    if (!draft.featherlessBaseUrl.trim()) {
      setResult('Empty Featherless base URL.');
      setTesting(false);
      return;
    }
    const url = endpointUrl(featherEndpointArgs(draft), '/chat/completions');
    try {
      const post = await fetch(url, {
        method: 'POST',
        headers: {
          ...authHeaders(draft.featherlessToken),
          'HTTP-Referer': 'http://localhost:5173',
          'X-Title': 'ablit',
        },
        body: JSON.stringify({
          model: resolveFeatherlessModelId(draft.featherlessModel),
          stream: false,
          messages: [{ role: 'user', content: 'Reply with the single word pong.' }],
          max_tokens: 256,
        }),
      });
      const postText = await post.text();
      let summary = 'POST ' + url + ' ' + String(post.status);
      try {
        const json = JSON.parse(postText) as {
          model?: string;
          choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }>;
        };
        summary += '\nmodel: ' + (json.model || draft.featherlessModel);
        summary += '\nfinish: ' + (json.choices?.[0]?.finish_reason || '');
        summary += '\ncontent: ' + JSON.stringify(json.choices?.[0]?.message?.content ?? null);
      } catch {
        summary += '\n' + postText.slice(0, 500);
      }
      setResult(summary);
    } catch (err) {
      setResult(formatFetchError(err));
    } finally {
      setTesting(false);
    }
  };

  const debugFeatherless = async () => {
    setTesting(true);
    setResult('');
    if (draft.featherlessEnabled === false) {
      setResult('Featherless endpoint unavailable — enable it first.');
      setTesting(false);
      return;
    }
    if (!draft.featherlessToken.trim() && !isLocalFeatherOAuthBase(draft.featherlessBaseUrl)) {
      setResult('No Featherless API key. Paste a key, then Debug responses.');
      setTesting(false);
      return;
    }
    const model = resolveFeatherlessModelId(draft.featherlessModel);
    const chatUrl = endpointUrl(featherEndpointArgs(draft), '/chat/completions');
    const modelsUrl = endpointUrl(featherEndpointArgs(draft), '/models');
    const headers: Record<string, string> = {
      ...authHeaders(draft.featherlessToken),
      'HTTP-Referer': 'http://localhost:5173',
      'X-Title': 'ablit',
    };
    let features = '';
    let modelsHint = '';
    try {
      const detailUrl = modelsUrl.replace(/\/$/, '') + '/' + model;
      const detailRes = await coalesceFetch(detailUrl, { headers });
      const detailText = await detailRes.text();
      if (detailRes.ok) {
        try {
          const json = JSON.parse(detailText) as { features?: unknown; context_length?: unknown };
          features = JSON.stringify(json.features ?? {}) + ` context=${String(json.context_length ?? '')}`;
        } catch {
          features = detailText.slice(0, 200);
        }
      } else {
        features = `GET model ${detailRes.status}: ${extractHttpErrorMessage(detailRes.status, detailText)}`;
      }
      const toolUrl =
        modelsUrl +
        (modelsUrl.includes('?') ? '&' : '?') +
        'capabilities=tool-use&per_page=5';
      const toolRes = await coalesceFetch(toolUrl, { headers });
      const toolText = await toolRes.text();
      if (toolRes.ok) {
        try {
          const json = JSON.parse(toolText) as { data?: Array<{ id?: string; features?: { tool_use?: boolean } }> };
          const ids = (json.data || []).map((m) => m.id).filter(Boolean).slice(0, 5);
          modelsHint = 'tool-use sample: ' + (ids.join(', ') || '(none)');
        } catch {
          modelsHint = 'tool-use list: ' + toolText.slice(0, 160);
        }
      } else {
        modelsHint = `GET tool-use ${toolRes.status}: ${extractHttpErrorMessage(toolRes.status, toolText)}`;
      }
    } catch (err) {
      modelsHint = formatFetchError(err);
    }
    try {
      const rows = await probeFeatherlessChat({
        url: chatUrl,
        token: draft.featherlessToken,
        model,
      });
      setResult(formatFeatherlessProbeReport({ model, features, modelsHint, rows }));
    } catch (err) {
      setResult(formatFetchError(err));
    } finally {
      setTesting(false);
    }
  };

  const listFeatherlessModels = async () => {
    setTesting(true);
    setResult('');
    if (draft.featherlessEnabled === false) {
      setResult('Featherless endpoint unavailable — enable it first.');
      setTesting(false);
      return;
    }
    const url = endpointUrl(featherEndpointArgs(draft), '/models');
    try {
      const headers: Record<string, string> = {
        'X-Retention': 'none',
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'ablit',
      };
      if (draft.featherlessToken.trim()) headers.Authorization = 'Bearer ' + draft.featherlessToken.trim();
      const res = await coalesceFetch(url, { headers });
      const text = await res.text();
      let summary = 'GET ' + url + ' ' + String(res.status);
      try {
        const json = JSON.parse(text) as { data?: { id?: string }[] } | { id?: string }[];
        const raw = Array.isArray(json) ? json : Array.isArray(json.data) ? json.data : [];
        const items = raw
          .map((row) => (row && typeof row.id === 'string' ? { id: row.id } : null))
          .filter((m): m is { id: string } => m != null);
        const allowed = mergePinnedFeatherlessModels(filterFeatherlessQwenModels(items));
        summary += '\nLarge Qwen filter: ' + String(allowed.length) + ' / ' + String(items.length);
        summary += '\nPinned 32B abliterated: ' + PINNED_FEATHERLESS_MODELS.length;
        if (!allowed.length) summary += '\n' + FEATHERLESS_EMPTY_STATE;
        else summary += '\n' + allowed.slice(0, 40).map((m) => m.id).join('\n');
      } catch {
        summary += '\n' + text.slice(0, 2000);
      }
      setResult(summary);
    } catch (err) {
      setResult(formatFetchError(err));
    } finally {
      setTesting(false);
    }
  };


  const connectPlatform = async () => {
    setTesting(true);
    setResult('');
    try {
      const deviceId = (draft.deviceId || '').trim() || 'desktop-device-unknown';
      if (deviceId.length < 8) {
        setResult('Set a deviceId via Settings → Account (sign in) before connecting Platform.');
        return;
      }
      const body =
        draft.loginId?.trim()
          ? { loginId: draft.loginId.trim(), deviceId }
          : draft.licenseKey?.trim()
            ? { licenseKey: draft.licenseKey.trim(), deviceId }
            : draft.accountEmail?.trim()
              ? null
              : null;
      if (!body) {
        setResult(
          'Sign in or activate a license first (Settings → Account / License), then Connect Platform.',
        );
        return;
      }
      // Email+password is not stored in settings; loginId or licenseKey path only.
      const creds = await fetchPlatformCredentials(
        { billingSiteUrl: draft.billingSiteUrl },
        body,
      );
      const next = {
        ...draft,
        inferenceProvider: 'platform' as const,
        remoteHostEnabled: true,
        baseUrl: creds.baseUrl,
        token: creds.apiKey,
        defaultModel: creds.defaultModel || 'standard',
      };
      setDraft(next);
      setSettings(next);
      onSettingsChange(next);
      setResult(
        'Platform connected. keyId=' +
          creds.keyId +
          ' baseUrl=' +
          creds.baseUrl +
          (creds.maxBudget != null ? ' max_budget=$' + String(creds.maxBudget) : '') +
          '\nVirtual key stored in local settings (not logged). Featherless Scale ToS applies.',
      );
    } catch (err) {
      setResult(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  const provider = draft.inferenceProvider || 'abliteration';
  const selectedModelId =
    provider === 'featherless'
      ? draft.featherlessModel
      : provider === 'dgx-spark'
        ? draft.sparkModel
        : draft.defaultModel;
  const sparkInactive = provider === 'dgx-spark' && !draft.sparkEnabled;
  const featherInactive = provider === 'featherless' && draft.featherlessEnabled === false;
  const active = resolveActiveSettings(draft);
  const authMissing = missingInferenceAuthError(active);
  const signedIn = Boolean(featherSession?.signedIn);
  const selectProvider = (id: InferenceProvider) => {
    const next = sanitizeSettings(applyInferenceProvider(draft, id));
    setDraft(next);
    setSettings(next);
    onSettingsChange(next);
  };

  return (
    <div className="h-full overflow-auto p-4">
      <header className="page-header">
        <div className="page-header-title">API</div>
        <p className="page-header-sub">
          Chat completions use one provider at a time. Image gen on Spark stays separate.
        </p>
        <p className="mt-2 font-mono text-[11px] text-zinc-400">
          Active <span className="text-emerald-300">{active.label}</span>
          {sparkInactive ? ' · Spark off — using cloud fields until enabled' : ''}
          {featherInactive ? ' · Featherless off — using cloud fields until enabled' : ''}
        </p>
      </header>

      <div className="mx-auto grid max-w-3xl gap-4 pb-8">
        <Section title="Provider" hint={PROVIDER_HINT[provider]}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {INFERENCE_PROVIDERS.map((p) => {
              const on = provider === p.id;
              const configured = isProviderConfigured(draft, p.id);
              const reason = providerUnconfiguredReason(draft, p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectProvider(p.id)}
                  className={
                    'group relative rounded-lg border px-3 py-2.5 text-left transition-all ' +
                    (on
                      ? 'border-emerald-500/80 bg-emerald-950/25 ring-1 ring-emerald-500/50'
                      : 'border-border bg-background/40 hover:border-primary/40 hover:bg-accent/40')
                  }
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <div className={'text-[13px] font-medium ' + (on ? 'text-emerald-200 font-semibold' : 'text-foreground')}>
                      {p.label}
                    </div>
                    {configured ? (
                      <span className="rounded-full border border-emerald-800/60 bg-emerald-950/60 px-1.5 py-0.2 font-mono text-[8.5px] font-bold text-emerald-300">
                        Ready
                      </span>
                    ) : (
                      <span className="rounded-full border border-amber-800/60 bg-amber-950/60 px-1.5 py-0.2 font-mono text-[8.5px] font-bold text-amber-300" title={reason || undefined}>
                        Setup Needed
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{PROVIDER_HINT[p.id]}</div>
                </button>
              );
            })}
          </div>

          {active.fallbackReason ? (
            <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-amber-800/70 bg-amber-950/30 p-2.5 font-mono text-[11px] text-amber-200">
              <span className="text-base">🛡️</span>
              <div>
                <div className="font-bold text-amber-100">Safe Active Endpoint Guard Engaged</div>
                <div className="mt-0.5 text-amber-300/90">{active.fallbackReason}</div>
              </div>
            </div>
          ) : null}

          {/* AI Agent API & Workflow Profile Alignment Strip */}
          {(() => {
            const alignment = getProviderSetupAlignment(provider);
            const status = checkProviderAlignment(draft, provider);
            return (
              <div className="mt-3 rounded-xl border border-zinc-800/80 bg-zinc-950/70 p-3 shadow-inner">
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="text-lg">
                      {provider === 'dgx-spark'
                        ? '⚡'
                        : provider === 'featherless'
                        ? '🪶'
                        : provider === 'platform'
                        ? '🏛️'
                        : provider === 'custom'
                        ? '🔌'
                        : '🔮'}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] font-bold text-white">
                          Aligned Setup for {alignment.name}:
                        </span>
                        <span className="rounded bg-emerald-950/80 border border-emerald-500/50 px-1.5 py-0.2 font-mono text-[10px] font-bold text-emerald-300">
                          {status.recommendedSetup.name}
                        </span>
                        <span className="font-mono text-[10px] text-zinc-400">
                          ({alignment.recommendedMode} mode · {alignment.recommendedNumbers.maxAgentTurns} turns max)
                        </span>
                      </div>
                      <p className="mt-0.5 font-mono text-[11px] text-zinc-400">
                        {alignment.tagline}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {status.isAligned ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/60 bg-emerald-950/60 px-2.5 py-1 font-mono text-[10px] font-semibold text-emerald-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        ✓ Agent Profile Aligned
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => patch(alignSetupForProvider(draft, provider))}
                        className="btn-ghost h-7 px-2.5 font-mono text-[10px] font-bold text-emerald-300 hover:text-white hover:bg-emerald-600/25 border border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.15)]"
                        title={`Optimize turn caps, agent mode, and switches for ${alignment.name}`}
                      >
                        ⚡ Align Agent Profile to {alignment.name}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {authMissing ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-200">
              {authMissing}
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground">Ready to send completions with the settings below.</p>
          )}
        </Section>

        {provider === 'dgx-spark' ? (
          <Section
            title="DGX Spark"
            hint={`Qwen (${SPARK_CHAT_MODEL}) on :8000. NVIDIA Sync uses 127.0.0.1 and Vite /spark-v1.`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => patch(sparkChatSettingsPatch(draft))} className="btn-primary h-8 px-3 text-[12px]">
                Use Spark Qwen
              </button>
              <label className="flex items-center gap-2 text-[13px] text-foreground">
                <input
                  type="checkbox"
                  checked={draft.sparkEnabled}
                  onChange={(e) => patch({ sparkEnabled: e.target.checked })}
                />
                Endpoint available
              </label>
            </div>
            {sparkInactive ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
                Spark is selected but marked unavailable. Enable the toggle to test or chat.
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Base URL" hint="vLLM OpenAI-compatible /v1">
                <input
                  value={draft.sparkBaseUrl}
                  onChange={(e) => patch({ sparkBaseUrl: e.target.value })}
                  placeholder="http://127.0.0.1:8000/v1"
                  className="field"
                />
              </Field>
              <Field label="Model">
                <input
                  value={draft.sparkModel}
                  onChange={(e) => patch({ sparkModel: e.target.value })}
                  placeholder="qwen-abliterated"
                  className="field"
                />
              </Field>
              <Field label="Token (optional)">
                <input
                  type="password"
                  value={draft.sparkToken}
                  onChange={(e) => patch({ sparkToken: e.target.value })}
                  autoComplete="off"
                  className="field"
                />
              </Field>
              <Field label="LAN host" hint="e.g. 192.168.4.101 — applied on blur">
                <input
                  value={draft.sparkLanHost}
                  onChange={(e) => patch({ sparkLanHost: e.target.value })}
                  onBlur={() => {
                    if (draft.inferenceProvider === 'dgx-spark') {
                      patch(sparkChatSettingsPatch({ ...draft, sparkLanHost: draft.sparkLanHost }));
                    }
                  }}
                  placeholder="192.168.4.101"
                  className="field"
                />
              </Field>
              <Field label="NVIDIA Sync SSH alias">
                <input
                  value={draft.sparkSshAlias}
                  onChange={(e) => patch({ sparkSshAlias: e.target.value })}
                  placeholder="flak3dd"
                  className="field"
                />
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-[13px] text-foreground">
                <input
                  type="checkbox"
                  checked={draft.sparkViaProxy}
                  onChange={(e) => patch({ sparkViaProxy: e.target.checked })}
                />
                Proxy via Vite /spark-v1
              </label>
            </div>
            <p className="text-[12px] leading-5 text-muted-foreground">
              Install package is in spark-install/. Push from this machine (weights stay on Spark):
              <br />
              <code className="break-all text-[11px] text-zinc-300">{sparkPushCommand(draft.sparkSshAlias)}</code>
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(sparkPushCommand(draft.sparkSshAlias))}
                className="btn-ghost h-8 px-3 text-[12px]"
              >
                Copy install command
              </button>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(sparkQwenPushCommand(draft.sparkSshAlias))}
                className="btn-ghost h-8 px-3 text-[12px]"
              >
                Copy Qwen push + start
              </button>
              <button type="button" onClick={() => void window.ablitDesktop?.revealSparkInstall?.()} className="btn-ghost h-8 px-3 text-[12px]">
                Reveal package
              </button>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              <button
                type="button"
                onClick={() => void testSpark()}
                disabled={testing || !draft.sparkEnabled}
                className="btn-primary h-8 px-3 text-[12px]"
              >
                {testing ? 'Testing…' : 'Test Spark'}
              </button>
              <button
                type="button"
                onClick={() => void listSparkModels()}
                disabled={testing || !draft.sparkEnabled}
                className="btn-ghost h-8 px-3 text-[12px]"
              >
                List models
              </button>
            </div>
          </Section>
        ) : provider === 'featherless' ? (
          <Section
            title="Featherless"
            hint={`Large Qwen (dense ≥32B / activated ≥16B; Qwen3.8-27B uncensored exception) plus pinned GLM. Default ${DEFAULT_FEATHERLESS_MODEL}.`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => patch(abliterationGradeFeatherlessPatch())}
                className="btn-primary h-8 px-3 text-[12px]"
              >
                Abliteration-grade preset
              </button>
              <button
                type="button"
                onClick={() =>
                  patch({
                    featherlessBaseUrl: CLOUD_FEATHERLESS_BASE,
                    featherlessViaProxy: false,
                    featherlessEnabled: true,
                  })
                }
                className="btn-ghost h-8 px-3 text-[12px]"
              >
                Use cloud API
              </button>
              <label className="flex items-center gap-2 text-[13px] text-foreground">
                <input
                  type="checkbox"
                  checked={draft.featherlessEnabled !== false}
                  onChange={(e) => patch({ featherlessEnabled: e.target.checked })}
                />
                Endpoint available
              </label>
            </div>
            {featherInactive ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
                Featherless is selected but marked unavailable. Enable the toggle to test or chat.
              </div>
            ) : null}

            <div className="rounded-md border border-border bg-background/50 p-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Auth</div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span
                  className={
                    'rounded-md border px-2 py-0.5 font-mono text-[10px] ' +
                    (signedIn
                      ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
                      : 'border-border bg-background text-muted-foreground')
                  }
                >
                  Local sign-in: {signedIn ? 'signed in' : featherSession == null ? 'cloud key' : 'signed out'}
                  {signedIn && featherSession?.expiresAt
                    ? ' · exp ' + new Date(featherSession.expiresAt).toLocaleString()
                    : ''}
                </span>
                <button
                  type="button"
                  onClick={() => signInFeatherless()}
                  disabled={draft.featherlessEnabled === false || !isLocalFeatherOAuthBase(draft.featherlessBaseUrl)}
                  className="btn-ghost h-8 px-3 text-[12px]"
                >
                  Sign in (local :3000)
                </button>
                <button
                  type="button"
                  onClick={() => void logoutFeatherless()}
                  disabled={draft.featherlessEnabled === false || !isLocalFeatherOAuthBase(draft.featherlessBaseUrl)}
                  className="btn-ghost h-8 px-3 text-[12px]"
                >
                  Logout
                </button>
                <button
                  type="button"
                  onClick={() => void refreshFeatherSession()}
                  disabled={!isLocalFeatherOAuthBase(draft.featherlessBaseUrl)}
                  className="btn-ghost h-8 px-3 text-[12px]"
                >
                  Refresh session
                </button>
              </div>
              {!isLocalFeatherOAuthBase(draft.featherlessBaseUrl) ? (
                <p className="mb-2 text-[12px] text-muted-foreground">
                  Cloud key mode. Paste a Featherless API key. Sign-in is only for local :3000.
                </p>
              ) : (
                <p className="mb-2 text-[12px] text-amber-200/90">
                  Local OAuth mode. Start the proxy on :3000, or switch to Use cloud API.
                </p>
              )}
              <Field label="API key">
                <input
                  type="password"
                  value={draft.featherlessToken}
                  onChange={(e) => patch({ featherlessToken: e.target.value })}
                  autoComplete="off"
                  className="field"
                  placeholder="fl-…"
                />
              </Field>
            </div>

            <Field label="Base URL" hint="Cloud: https://api.featherless.ai/v1 · Local OAuth: http://127.0.0.1:3000/v1">
              <input
                value={draft.featherlessBaseUrl}
                onChange={(e) => patch({ featherlessBaseUrl: e.target.value })}
                placeholder="https://api.featherless.ai/v1"
                className="field"
              />
            </Field>
            <label className="flex items-center gap-2 text-[13px] text-foreground">
              <input
                type="checkbox"
                checked={draft.featherlessViaProxy === true}
                onChange={(e) => patch({ featherlessViaProxy: e.target.checked })}
              />
              Proxy local :3000 via Vite /featherless-v1
            </label>

            <div>
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Model</div>
              <p className="mb-2 text-[12px] text-muted-foreground">Pick a pinned id, or type any allowed Featherless model.</p>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {PINNED_FEATHERLESS_MODELS.map((m) => {
                  const on = draft.featherlessModel === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      title={m.id}
                      onClick={() => patch({ featherlessModel: m.id, ...recommendedApiPatch(m.id, draft) })}
                      className={
                        'rounded-md border px-2 py-1 text-left text-[11px] leading-tight ' +
                        (on
                          ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
                          : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground')
                      }
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
              <input
                value={draft.featherlessModel}
                onChange={(e) => patch({ featherlessModel: e.target.value })}
                placeholder={DEFAULT_FEATHERLESS_MODEL}
                className="field font-mono text-[12px]"
                aria-label="Featherless model id"
              />
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              <button
                type="button"
                onClick={() => void testFeatherless()}
                disabled={testing || draft.featherlessEnabled === false}
                className="btn-primary h-8 px-3 text-[12px]"
              >
                {testing ? 'Testing…' : 'Test connection'}
              </button>
              <button
                type="button"
                onClick={() => void listFeatherlessModels()}
                disabled={testing || draft.featherlessEnabled === false}
                className="btn-ghost h-8 px-3 text-[12px]"
              >
                List models
              </button>
              <button
                type="button"
                onClick={() => void debugFeatherless()}
                disabled={testing || draft.featherlessEnabled === false}
                className="btn-ghost h-8 px-3 text-[12px]"
              >
                {testing ? 'Debugging…' : 'Debug responses'}
              </button>
            </div>
          </Section>
        ) : provider === 'platform' ? (
          <Section
            title="Platform"
            hint="Abliterated Cloud via LiteLLM (virtual key + budget). Connect with your license — not a Featherless master key."
          >
            <Field label="Gateway base URL">
              <input
                value={draft.baseUrl}
                onChange={(e) => patch({ baseUrl: e.target.value })}
                placeholder="https://abliterated.app/api/v1"
                className="field"
              />
            </Field>
            <Field label="Virtual key" hint="Filled by Connect with account. Stored only in local settings.">
              <input
                type="password"
                value={draft.token}
                onChange={(e) => patch({ token: e.target.value })}
                autoComplete="off"
                className="field"
              />
            </Field>
            <Field label="Default model alias" hint="standard or economy, or a raw Featherless id allowed on the key.">
              <input
                value={draft.defaultModel}
                onChange={(e) => patch({ defaultModel: e.target.value })}
                placeholder="standard"
                className="field"
              />
            </Field>
            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              <button
                type="button"
                onClick={() => void connectPlatform()}
                disabled={testing}
                className="btn-primary h-8 px-3 text-[12px]"
              >
                {testing ? 'Connecting…' : 'Connect with account'}
              </button>
              <button type="button" onClick={() => void testCloudOrCustom()} disabled={testing} className="btn-ghost h-8 px-3 text-[12px]">
                {testing ? 'Testing…' : 'Test connection'}
              </button>
            </div>
          </Section>
        ) : provider === 'custom' ? (
          <Section title="Custom" hint="OpenAI-compatible endpoint. Fields start empty.">
            <Field label="Base URL">
              <input
                value={draft.baseUrl}
                onChange={(e) => patch({ baseUrl: e.target.value })}
                placeholder="https://api.example.com/v1"
                className="field"
              />
            </Field>
            <Field label="Token">
              <input
                type="password"
                value={draft.token}
                onChange={(e) => patch({ token: e.target.value })}
                placeholder="sk-…"
                autoComplete="off"
                className="field"
              />
            </Field>
            <Field label="Default model">
              <input
                value={draft.defaultModel}
                onChange={(e) => patch({ defaultModel: e.target.value })}
                placeholder="model-id"
                className="field"
              />
            </Field>
            <div className="border-t border-border pt-3">
              <button type="button" onClick={() => void testCloudOrCustom()} disabled={testing} className="btn-primary h-8 px-3 text-[12px]">
                {testing ? 'Testing…' : 'Test connection'}
              </button>
            </div>
          </Section>
        ) : (
          <Section title="Abliteration" hint="Cloud abliteration.ai. Empty URL/token fall back to the built-in defaults.">
            <Field label="Base URL">
              <input
                value={draft.baseUrl}
                onChange={(e) => patch({ baseUrl: e.target.value })}
                placeholder="https://api.abliteration.ai/v1"
                className="field"
              />
            </Field>
            <Field label="Token">
              <input
                type="password"
                value={draft.token}
                onChange={(e) => patch({ token: e.target.value })}
                autoComplete="off"
                className="field"
              />
            </Field>
            <Field label="Default model">
              <input
                value={draft.defaultModel}
                onChange={(e) => patch({ defaultModel: e.target.value })}
                placeholder="abliterated-model"
                className="field"
              />
            </Field>
            <div className="border-t border-border pt-3">
              <button type="button" onClick={() => void testCloudOrCustom()} disabled={testing} className="btn-primary h-8 px-3 text-[12px]">
                {testing ? 'Testing…' : 'Test connection'}
              </button>
            </div>
          </Section>
        )}

        <Section
          title="Sampling"
          hint="Applies to chat on the selected provider. Completions use max_tokens 4096; history is trimmed to this window."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Reasoning">
              <select
                value={draft.reasoning}
                onChange={(e) => patch({ reasoning: e.target.value as ReasoningLevel })}
                className="field"
              >
                {REASONING.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Context length"
              hint="Prompt window, not max_tokens. Empty = 32768 on Featherless, 131072 otherwise."
            >
              <input
                type="number"
                min={0}
                value={draft.contextLength ?? ''}
                onChange={(e) => patch({ contextLength: e.target.value ? Number(e.target.value) : undefined })}
                className="field"
                title="Model prompt window. Chat is trimmed to this minus max_tokens."
              />
            </Field>
          </div>
          {selectedModelId?.trim() ? (
            <ModelSettingsGuidePanel
              model={selectedModelId}
              settings={draft}
              onSettingsChange={(s) => {
                setDraft(s);
                onSettingsChange(s);
              }}
            />
          ) : null}
        </Section>

        <Section
          title="Image generation"
          hint="Optional. Spark is the local Diffusers bridge (:7860). xAI Imagine is cloud grok-imagine-image-2.0 (paste an xAI key)."
        >
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                patch({
                  imageGenEnabled: true,
                  imageBackend: 'spark',
                  imageBaseUrl: draft.imageBaseUrl || sparkImageSettingsPatch(draft, UNCENSORED_IMAGE_MODEL).imageBaseUrl,
                })
              }
              className={'h-8 px-3 text-[12px] ' + (!isXaiImageBackend(draft) ? 'btn-primary' : 'btn-ghost')}
            >
              Spark (local)
            </button>
            <button
              type="button"
              onClick={() => patch(xaiImageSettingsPatch(draft))}
              className={'h-8 px-3 text-[12px] ' + (isXaiImageBackend(draft) ? 'btn-primary' : 'btn-ghost')}
            >
              xAI Imagine
            </button>
            <button
              type="button"
              onClick={() => window.open('http://127.0.0.1:17326/', '_blank')}
              className="btn-ghost h-8 px-3 text-[12px]"
            >
              Open Image Studio (:17326)
            </button>
          </div>
          {isXaiImageBackend(draft) ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="xAI base URL">
                <input
                  value={draft.xaiImageBaseUrl}
                  onChange={(e) => patch({ xaiImageBaseUrl: e.target.value })}
                  placeholder={XAI_IMAGE_BASE_URL}
                  className="field"
                />
              </Field>
              <Field label="xAI API key" hint="From console.x.ai. Not the chat token.">
                <input
                  type="password"
                  value={draft.xaiImageToken}
                  onChange={(e) => patch({ xaiImageToken: e.target.value })}
                  autoComplete="off"
                  className="field"
                  placeholder="xai-…"
                />
              </Field>
              <Field label="Model">
                <input value={draft.xaiImageModel || XAI_IMAGE_MODEL} onChange={(e) => patch({ xaiImageModel: e.target.value })} className="field" />
              </Field>
              <Field label="Resolution">
                <select
                  value={draft.xaiImageResolution || '2k'}
                  onChange={(e) => patch({ xaiImageResolution: e.target.value === '1k' ? '1k' : '2k' })}
                  className="field"
                >
                  <option value="1k">1k</option>
                  <option value="2k">2k</option>
                </select>
              </Field>
              <Field label="Quality" hint="auto / low / medium. 2.0 only.">
                <select
                  value={draft.xaiImageQuality || 'auto'}
                  onChange={(e) =>
                    patch({
                      xaiImageQuality:
                        e.target.value === 'low' || e.target.value === 'medium' ? e.target.value : 'auto',
                    })
                  }
                  className="field"
                >
                  {XAI_QUALITIES.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Model">
                  <select
                    value={draft.imageModel || UNCENSORED_IMAGE_MODEL}
                    onChange={(e) => patch({ imageModel: e.target.value })}
                    className="field"
                  >
                    {IMAGE_MODEL_OPTIONS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Base URL" hint="Local or LAN Diffusers bridge (:7860)">
                  <input
                    value={draft.imageBaseUrl || sparkImageUrl(draft)}
                    onChange={(e) => patch({ imageBaseUrl: e.target.value })}
                    placeholder="http://127.0.0.1:7860/v1"
                    className="field"
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] uppercase text-muted">Quick presets:</span>
                <button
                  type="button"
                  onClick={() => patch(sparkImageSettingsPatch(draft, UNCENSORED_IMAGE_MODEL))}
                  className="btn-ghost h-7 px-2.5 text-[11px]"
                >
                  Quality (Krea RAW)
                </button>
                <button
                  type="button"
                  onClick={() => patch(sparkImageSettingsPatch(draft, FAST_IMAGE_MODEL))}
                  className="btn-ghost h-7 px-2.5 text-[11px]"
                >
                  Fast (Turbo)
                </button>
                <button
                  type="button"
                  onClick={() => patch(sparkImageSettingsPatch(draft, DRAFT_IMAGE_MODEL))}
                  className="btn-ghost h-7 px-2.5 text-[11px]"
                >
                  Draft (Z-Image)
                </button>
              </div>
              <p className="font-mono text-[11px] text-zinc-400">
                Bridge: <code className="text-zinc-300">{draft.imageBaseUrl || sparkImageUrl(draft)}</code> · {sparkBridgeDownHint(draft)}
              </p>
            </div>
          )}
        </Section>

        {result ? (
          <Section title="Last test">
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-5 text-zinc-300">
              {result}
            </pre>
          </Section>
        ) : null}
      </div>
    </div>
  );
}
