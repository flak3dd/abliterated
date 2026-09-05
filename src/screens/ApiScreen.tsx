import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyInferenceProvider,
  INFERENCE_PROVIDERS,
  missingInferenceAuthError,
  resolveActiveSettings,
} from '../lib/activeEndpoint';
import { endpointUrl, formatFetchError } from '../lib/apiUrl';
import { setSettings } from '../lib/storage';
import type { ClientSettings, ReasoningLevel } from '../types';

interface Props {
  settings: ClientSettings;
  onSettingsChange: (s: ClientSettings) => void;
}

const REASONING: ReasoningLevel[] = ['off', 'low', 'high', 'max'];
type FeatherSession = { ok?: boolean; signedIn?: boolean; expiresAt?: string | null; scope?: string | null };

const CLOUD_FEATHERLESS_BASE = 'https://api.featherless.ai/v1';

function isLocalFeatherOAuthBase(baseUrl: string): boolean {
  const u = (baseUrl || '').trim().replace(/\/$/, '');
  return u === 'http://127.0.0.1:3000/v1' || u === 'http://localhost:3000/v1';
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
    const next = { ...draft, ...partial };
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
    try {
      const post = await fetch(url, {
        method: 'POST',
        headers: authHeaders(draft.sparkToken),
        body: JSON.stringify({
          model: draft.sparkModel || 'qwen-abliterated',
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
        summary += '\nmodel: ' + (json.model || draft.sparkModel);
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
      const headers: Record<string, string> = { 'X-Retention': 'none' };
      if (draft.sparkToken.trim()) headers.Authorization = 'Bearer ' + draft.sparkToken.trim();
      const res = await fetch(url, { headers });
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
          model: draft.featherlessModel || 'Qwen/Qwen2.5-7B-Instruct',
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
      const res = await fetch(url, { headers });
      const text = await res.text();
      setResult('GET ' + url + ' ' + String(res.status) + '\n' + text.slice(0, 2000));
    } catch (err) {
      setResult(formatFetchError(err));
    } finally {
      setTesting(false);
    }
  };

  const provider = draft.inferenceProvider || 'abliteration';
  const sparkInactive = provider === 'dgx-spark' && !draft.sparkEnabled;
  const featherInactive = provider === 'featherless' && draft.featherlessEnabled === false;
  const active = resolveActiveSettings(draft);
  const authMissing = missingInferenceAuthError(active);
  const signedIn = Boolean(featherSession?.signedIn);
  // Keep helpers referenced until the dedicated Featherless provider panel is fully inlined in JSX.

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-3 font-mono text-xs font-semibold tracking-wide text-zinc-200">API</div>
      <div className="grid max-w-2xl gap-3">
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase text-muted">Provider</div>
          <div className="flex flex-wrap gap-1">
            {INFERENCE_PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  const next = applyInferenceProvider(draft, p.id);
                  setDraft(next);
                  setSettings(next);
                  onSettingsChange(next);
                }}
                className={
                  'rounded border px-2 py-1 font-mono text-[11px] ' +
                  (provider === p.id
                    ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
                    : 'border-border text-zinc-300 hover:bg-zinc-900')
                }
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="mt-1 font-mono text-[10px] text-muted">
            Active: {active.label}
            {sparkInactive ? ' (Spark off — falling back to cloud fields until enabled)' : ''}
            {featherInactive ? ' (Featherless off — falling back to cloud fields until enabled)' : ''}
          </p>
          {authMissing ? (
            <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 font-mono text-[11px] leading-5 text-amber-200">
              {authMissing}
            </div>
          ) : null}
        </div>

        {provider === 'dgx-spark' ? (
          <>
            <p className="font-mono text-[10px] text-muted">
              NIM on DGX Spark. Default http://127.0.0.1:8000/v1. Tunnel or set DGX_SPARK_URL for LAN.
              Alternate: Qwen abliterated on Spark via spark/ scripts.
            </p>
            <label className="flex items-center gap-2 font-mono text-[11px] text-zinc-200">
              <input
                type="checkbox"
                checked={draft.sparkEnabled}
                onChange={(e) => patch({ sparkEnabled: e.target.checked })}
              />
              Spark endpoint available
            </label>
            {sparkInactive ? (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-mono text-[11px] text-amber-200">
                Provider is DGX Spark but the endpoint is marked unavailable. Enable the toggle to test or chat.
              </div>
            ) : null}
            <label className="block font-mono text-[10px] uppercase text-muted">
              Spark base URL
              <input
                value={draft.sparkBaseUrl}
                onChange={(e) => patch({ sparkBaseUrl: e.target.value })}
                placeholder="http://127.0.0.1:8000/v1"
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs text-zinc-100 outline-none"
              />
            </label>
            <label className="block font-mono text-[10px] uppercase text-muted">
              Spark model
              <input
                value={draft.sparkModel}
                onChange={(e) => patch({ sparkModel: e.target.value })}
                placeholder="qwen-abliterated"
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs text-zinc-100 outline-none"
              />
            </label>
            <label className="block font-mono text-[10px] uppercase text-muted">
              Spark token (optional)
              <input
                type="password"
                value={draft.sparkToken}
                onChange={(e) => patch({ sparkToken: e.target.value })}
                autoComplete="off"
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs text-zinc-100 outline-none"
              />
            </label>
            <label className="flex items-center gap-2 font-mono text-[11px] text-zinc-200">
              <input
                type="checkbox"
                checked={draft.sparkViaProxy}
                onChange={(e) => patch({ sparkViaProxy: e.target.checked })}
              />
              Proxy via Vite /spark-v1
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void testSpark()}
                disabled={testing || !draft.sparkEnabled}
                className="w-fit rounded bg-zinc-100 px-3 py-1 font-mono text-[11px] font-medium text-zinc-900 disabled:opacity-50"
              >
                {testing ? 'Testing…' : 'Test Spark'}
              </button>
              <button
                type="button"
                onClick={() => void listSparkModels()}
                disabled={testing || !draft.sparkEnabled}
                className="w-fit rounded border border-border px-3 py-1 font-mono text-[11px] text-zinc-200 disabled:opacity-50"
              >
                List models
              </button>
            </div>
          </>
        ) : provider === 'featherless' ? (
          <>
            <p className="font-mono text-[10px] text-muted">
              Default: cloud API key at https://api.featherless.ai/v1 (DEV proxies via /featherless-api). Local OAuth optional: http://127.0.0.1:3000/v1 + npm run featherless-oauth.
            </p>
            <label className="flex items-center gap-2 font-mono text-[11px] text-zinc-200">
              <input
                type="checkbox"
                checked={draft.featherlessEnabled !== false}
                onChange={(e) => patch({ featherlessEnabled: e.target.checked })}
              />
              Featherless endpoint available
            </label>
            {featherInactive ? (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-mono text-[11px] text-amber-200">
                Provider is Featherless but the endpoint is marked unavailable. Enable the toggle to test or chat.
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={
                  'rounded border px-2 py-0.5 font-mono text-[10px] ' +
                  (signedIn
                    ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
                    : 'border-zinc-600 bg-zinc-900 text-zinc-400')
                }
              >
                OAuth: {signedIn ? 'signed in' : featherSession == null ? 'unknown' : 'signed out'}
                {signedIn && featherSession?.expiresAt
                  ? ' · exp ' + new Date(featherSession.expiresAt).toLocaleString()
                  : ''}
              </span>
              <button
                type="button"
                onClick={() => signInFeatherless()}
                disabled={draft.featherlessEnabled === false || !isLocalFeatherOAuthBase(draft.featherlessBaseUrl)}
                className="rounded border border-border px-2 py-1 font-mono text-[11px] text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
              >
                Sign in with Featherless
              </button>
              <button
                type="button"
                onClick={() => void logoutFeatherless()}
                disabled={draft.featherlessEnabled === false || !isLocalFeatherOAuthBase(draft.featherlessBaseUrl)}
                className="rounded border border-border px-2 py-1 font-mono text-[11px] text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
              >
                Logout
              </button>
              <button
                type="button"
                onClick={() => void refreshFeatherSession()}
                disabled={!isLocalFeatherOAuthBase(draft.featherlessBaseUrl)}
                className="rounded border border-border px-2 py-1 font-mono text-[11px] text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
              >
                Refresh session
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
                className="rounded border border-emerald-500/40 px-2 py-1 font-mono text-[11px] text-emerald-300 hover:bg-emerald-500/10"
              >
                Use cloud API key
              </button>
            </div>
            {!isLocalFeatherOAuthBase(draft.featherlessBaseUrl) ? (
              <p className="font-mono text-[10px] text-muted">
                API-key mode: paste your Featherless key below. Sign-in is only for local :3000.
              </p>
            ) : (
              <p className="font-mono text-[10px] text-amber-200/90">
                Local mode: start the local server on :3000 or switch to cloud API key.
              </p>
            )}
            <label className="block font-mono text-[10px] uppercase text-muted">
              Featherless base URL
              <input
                value={draft.featherlessBaseUrl}
                onChange={(e) => patch({ featherlessBaseUrl: e.target.value })}
                placeholder="https://api.featherless.ai/v1"
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs text-zinc-100 outline-none"
              />
            </label>
            <label className="block font-mono text-[10px] uppercase text-muted">
              Featherless model
              <input
                value={draft.featherlessModel}
                onChange={(e) => patch({ featherlessModel: e.target.value })}
                placeholder="Qwen/Qwen2.5-7B-Instruct"
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs text-zinc-100 outline-none"
              />
            </label>
            <label className="block font-mono text-[10px] uppercase text-muted">
              API key
              <input
                type="password"
                value={draft.featherlessToken}
                onChange={(e) => patch({ featherlessToken: e.target.value })}
                autoComplete="off"
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs text-zinc-100 outline-none"
              />
            </label>
            <label className="flex items-center gap-2 font-mono text-[11px] text-zinc-200">
              <input
                type="checkbox"
                checked={draft.featherlessViaProxy === true}
                onChange={(e) => patch({ featherlessViaProxy: e.target.checked })}
              />
              Proxy via Vite /featherless-v1
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void testFeatherless()}
                disabled={testing || draft.featherlessEnabled === false}
                className="w-fit rounded bg-zinc-100 px-3 py-1 font-mono text-[11px] font-medium text-zinc-900 disabled:opacity-50"
              >
                {testing ? 'Testing…' : 'Test connection'}
              </button>
              <button
                type="button"
                onClick={() => void listFeatherlessModels()}
                disabled={testing || draft.featherlessEnabled === false}
                className="w-fit rounded border border-border px-3 py-1 font-mono text-[11px] text-zinc-200 disabled:opacity-50"
              >
                List models
              </button>
            </div>
          </>

        ) : (
          <>
            <label className="block font-mono text-[10px] uppercase text-muted">
              Base URL
              <input
                value={draft.baseUrl}
                onChange={(e) => patch({ baseUrl: e.target.value })}
                placeholder="https://api.abliteration.ai/v1"
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs text-zinc-100 outline-none"
              />
            </label>
            <label className="block font-mono text-[10px] uppercase text-muted">
              Token
              <input
                type="password"
                value={draft.token}
                onChange={(e) => patch({ token: e.target.value })}
                autoComplete="off"
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs text-zinc-100 outline-none"
              />
            </label>
            <label className="block font-mono text-[10px] uppercase text-muted">
              Default model
              <input
                value={draft.defaultModel}
                onChange={(e) => patch({ defaultModel: e.target.value })}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs text-zinc-100 outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => void testCloudOrCustom()}
              disabled={testing}
              className="w-fit rounded bg-zinc-100 px-3 py-1 font-mono text-[11px] font-medium text-zinc-900 disabled:opacity-50"
            >
              {testing ? 'Testing…' : 'Test connection'}
            </button>
          </>
        )}

        <label className="block font-mono text-[10px] uppercase text-muted">
          Reasoning
          <select
            value={draft.reasoning}
            onChange={(e) => patch({ reasoning: e.target.value as ReasoningLevel })}
            className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs text-zinc-100 outline-none"
          >
            {REASONING.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="block font-mono text-[10px] uppercase text-muted">
          Context length
          <input
            type="number"
            min={0}
            value={draft.contextLength ?? ''}
            onChange={(e) => patch({ contextLength: e.target.value ? Number(e.target.value) : undefined })}
            className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs text-zinc-100 outline-none"
          />
        </label>
        {result ? <pre className="whitespace-pre-wrap rounded border border-border bg-background p-2 font-mono text-[11px] text-zinc-300">{result}</pre> : null}
      </div>
    </div>
  );
}
