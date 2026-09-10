import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { sparkChatSettingsPatch, sparkGptOssSettingsPatch } from '../lib/sparkInstall';
import { formatBytes, vllmCtl, VLLM_RECIPE_PRESETS, type VllmConfig, type VllmStatus } from '../lib/vllmCtl';
import type { ClientSettings } from '../types';

interface Props {
  settings: ClientSettings;
  onSettingsChange: (s: ClientSettings) => void;
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

function pill(ok: boolean, on: string, off: string) {
  return (
    <span
      className={
        'rounded-md border px-2 py-0.5 font-mono text-[10px] ' +
        (ok
          ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
          : 'border-amber-500/40 bg-amber-500/10 text-amber-200')
      }
    >
      {ok ? on : off}
    </span>
  );
}

export function VllmScreen({ settings, onSettingsChange }: Props) {
  const [alias, setAlias] = useState(settings.sparkSshAlias?.trim() || 'flak3dd');
  const [status, setStatus] = useState<VllmStatus | null>(null);
  const [cfg, setCfg] = useState<VllmConfig>({
    recipe: 'qwen',
    servedName: 'qwen-abliterated',
    port: 8000,
    gpuMemoryUtilization: 0.6,
    maxModelLen: 65536,
    kvCacheDtype: 'fp8',
    quantization: 'nvfp4',
    reasoningParser: 'qwen3',
    toolCallParser: 'qwen3_coder',
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState('');

  const refresh = useCallback(async () => {
    const s = (await vllmCtl('status', { alias, port: cfg.port })) as VllmStatus;
    setStatus(s);
    if (s.saved) setCfg((prev) => ({ ...prev, ...s.saved }));
    return s;
  }, [alias, cfg.port]);

  useEffect(() => {
    void refresh().catch((err) => setLog(err instanceof Error ? err.message : String(err)));
  }, [refresh]);

  const pickRecipe = (id: VllmConfig['recipe']) => {
    const r = (status?.recipes?.length ? status.recipes : VLLM_RECIPE_PRESETS).find((x) => x.id === id);
    if (!r) {
      setCfg((c) => ({ ...c, recipe: id }));
      return;
    }
    setCfg({
      recipe: r.id,
      servedName: r.servedName,
      port: cfg.port,
      gpuMemoryUtilization: r.gpuMemoryUtilization,
      maxModelLen: r.maxModelLen,
      kvCacheDtype: (r.kvCacheDtype as VllmConfig['kvCacheDtype']) || 'fp8',
      quantization: r.quantization,
      reasoningParser: r.reasoningParser,
      toolCallParser: r.toolCallParser,
    });
  };

  // Point the IDE provider at the currently selected recipe's served model. Switching
  // the vLLM server WITHOUT this leaves the app requesting the previous model name
  // (mismatch → 404 / garbled / empty responses), which is the "model switching is
  // broken" symptom. Serving a recipe now applies this automatically.
  const applyIdeProvider = () => {
    const patch =
      cfg.recipe === 'gpt-oss' ? sparkGptOssSettingsPatch(settings) : sparkChatSettingsPatch(settings);
    onSettingsChange({
      ...settings,
      ...patch,
      sparkSshAlias: alias,
      sparkModel: cfg.servedName,
      sparkBaseUrl: `http://127.0.0.1:${cfg.port}/v1`,
    });
  };

  const run = async (op: string, extra: Record<string, unknown> = {}) => {
    setBusy(op);
    try {
      const out = await vllmCtl(op, { alias, config: cfg, recipe: cfg.recipe, ...extra });
      const outLog =
        [out.stdout, out.stderr, out.state, out.error]
          .filter((x) => typeof x === 'string' && x.trim())
          .join('\n')
          .slice(-4000) || `${op} ok`;
      // Switching the served model must also switch what the IDE talks to.
      if (op === 'serve') {
        applyIdeProvider();
        setLog(`${outLog}\n→ IDE now uses DGX Spark · ${cfg.servedName}`);
      } else {
        setLog(outLog);
      }
      await refresh();
    } catch (err) {
      setLog(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const useInIde = () => {
    applyIdeProvider();
    setLog('IDE provider set to DGX Spark · ' + cfg.servedName);
  };

  const live = status?.live;
  const running = status?.docker.find((d) => d.running);

  return (
    <div className="h-full overflow-auto p-4">
      <header className="page-header">
        <div className="page-header-title">vLLM</div>
        <p className="page-header-sub">
          Spark text server on NVIDIA Sync. One model on :{cfg.port}. Qwen and GPT-OSS 120B cannot run together.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {pill(Boolean(status?.sshOk), 'ssh ' + alias, status?.sshError || 'ssh down')}
          {pill(Boolean(live?.health), 'tunnel :' + cfg.port, live?.healthError || 'tunnel down')}
          {pill(Boolean(running), running ? running.name : 'no container', running ? running.status : 'stopped')}
          {live?.version ? (
            <span className="rounded-md border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              vllm {live.version}
            </span>
          ) : null}
          {live?.models[0] ? (
            <span className="font-mono text-[11px] text-emerald-300">{live.models[0].id}</span>
          ) : (
            <span className="font-mono text-[11px] text-muted-foreground">no live model</span>
          )}
        </div>
      </header>

      <div className="mx-auto grid max-w-3xl gap-4 pb-8">
        <Section title="Host" hint="NVIDIA Sync SSH alias. Local :8000 is the forwarded vLLM port.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="SSH alias">
              <input value={alias} onChange={(e) => setAlias(e.target.value)} className="field" placeholder="flak3dd" />
            </Field>
            <Field label="Local port">
              <input
                type="number"
                value={cfg.port}
                onChange={(e) => setCfg((c) => ({ ...c, port: Number(e.target.value) }))}
                className="field"
              />
            </Field>
          </div>
          <p className="text-[12px] text-muted-foreground">
            Remote dir {status?.remoteDir || '…'}
            {status?.sshOk ? '' : status?.sshError ? ` · ${status.sshError}` : ''}
          </p>
        </Section>

        <Section title="Recipe" hint="Selecting a recipe fills parsers, quant, GPU fraction, and context.">
          <div className="grid gap-2 sm:grid-cols-2">
            {(status?.recipes?.length ? status.recipes : VLLM_RECIPE_PRESETS).map((r) => {
              const on = cfg.recipe === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => pickRecipe(r.id)}
                  className={
                    'rounded-lg border px-3 py-2.5 text-left transition-colors ' +
                    (on
                      ? 'border-emerald-500/60 bg-emerald-500/10'
                      : 'border-border bg-background/40 hover:border-primary/40 hover:bg-accent/40')
                  }
                >
                  <div className={'text-[13px] font-medium ' + (on ? 'text-emerald-200' : 'text-foreground')}>{r.label}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{r.servedName}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{r.hf}</div>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Serve flags" hint="Written to spark/vllm-ui.json and passed into docker compose as env.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Served name" hint="OpenAI model id the IDE must send">
              <input
                value={cfg.servedName}
                onChange={(e) => setCfg((c) => ({ ...c, servedName: e.target.value }))}
                className="field"
              />
            </Field>
            <Field label="GPU memory" hint="0.20–0.95 of unified memory">
              <input
                type="number"
                step="0.05"
                min={0.2}
                max={0.95}
                value={Number(cfg.gpuMemoryUtilization.toFixed(2))}
                onChange={(e) => setCfg((c) => ({ ...c, gpuMemoryUtilization: Number(e.target.value) }))}
                className="field"
              />
            </Field>
            <Field label="Max model len" hint="Prompt + completion window">
              <input
                type="number"
                value={cfg.maxModelLen}
                onChange={(e) => setCfg((c) => ({ ...c, maxModelLen: Number(e.target.value) }))}
                className="field"
              />
            </Field>
            <Field label="KV cache">
              <select
                value={cfg.kvCacheDtype}
                onChange={(e) => setCfg((c) => ({ ...c, kvCacheDtype: e.target.value as VllmConfig['kvCacheDtype'] }))}
                className="field"
              >
                <option value="fp8">fp8</option>
                <option value="auto">auto</option>
                <option value="fp16">fp16</option>
              </select>
            </Field>
          </div>
          <div className="grid gap-2 font-mono text-[11px] text-muted-foreground sm:grid-cols-3">
            <div>quant {cfg.quantization}</div>
            <div>reasoning {cfg.reasoningParser}</div>
            <div>tools {cfg.toolCallParser}</div>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <button type="button" disabled={!!busy} onClick={() => void refresh()} className="btn-ghost h-8 px-3 text-[12px]">
              Refresh
            </button>
            <button type="button" disabled={!!busy} onClick={() => void run('save')} className="btn-ghost h-8 px-3 text-[12px]">
              Save
            </button>
            <button type="button" disabled={!!busy} onClick={() => void run('serve')} className="btn-primary h-8 px-3 text-[12px]">
              {busy === 'serve' ? 'Serving…' : 'Serve'}
            </button>
            <button type="button" disabled={!!busy} onClick={() => void run('stop')} className="btn-danger h-8 px-3 text-[12px]">
              Stop
            </button>
            <button type="button" disabled={!!busy} onClick={() => void run('pull')} className="btn-ghost h-8 px-3 text-[12px]">
              {busy === 'pull' ? 'Pulling…' : 'Pull weights'}
            </button>
            <button type="button" onClick={useInIde} className="btn-ghost h-8 px-3 text-[12px]">
              Use in IDE
            </button>
          </div>
        </Section>

        <Section title="Weights on Spark" hint="Download stays on the Spark. IDE box never holds the safetensors.">
          {status?.pull.running ? (
            <p className="text-[12px] text-amber-200">
              Pull running · {formatBytes(status.pull.bytes)} · {status.pull.log || 'downloading'}
            </p>
          ) : null}
          <div className="grid gap-1">
            {(status?.models || []).length === 0 ? (
              <p className="text-[12px] text-muted-foreground">No model directories yet.</p>
            ) : (
              status?.models.map((m) => (
                <div key={m.name} className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/40 px-3 py-2">
                  <div>
                    <div className="font-mono text-[12px] text-foreground">{m.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {formatBytes(m.bytes)}
                      {m.shards ? ` · ${m.shards} shards` : ''}
                      {m.config ? ' · config.json' : ' · incomplete'}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Section>

        <Section title="Live endpoint" hint="GET /health and /v1/models through the local NVIDIA Sync tunnel.">
          {live?.models.length ? (
            <pre className="selectable overflow-auto rounded-md border border-border bg-background/60 p-3 font-mono text-[11px] leading-5 text-zinc-300">
              {JSON.stringify(live.models, null, 2)}
            </pre>
          ) : (
            <p className="text-[12px] text-muted-foreground">Nothing answering on 127.0.0.1:{cfg.port}.</p>
          )}
          {log ? (
            <pre className="selectable mt-2 max-h-40 overflow-auto rounded-md border border-border bg-background/60 p-3 font-mono text-[11px] leading-5 text-zinc-400">
              {log}
            </pre>
          ) : null}
        </Section>
      </div>
    </div>
  );
}
