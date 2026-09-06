import { setSettings } from '../../lib/storage';
import {
  applyRecommendedApiSettings,
  buildModelSettingsGuide,
  classifyModel,
  type GuideSettings,
  type GuideStatus,
} from '../../lib/modelSettingsGuide';
import { cn } from '../../lib/cn';
import type { ClientSettings, Tab } from '../../types';

interface Props {
  model: string;
  settings: ClientSettings;
  onSettingsChange: (s: ClientSettings) => void;
  onOpenTab?: (tab: Tab) => void;
  compact?: boolean;
}

function statusClass(status: GuideStatus): string {
  if (status === 'block') return 'text-red-300';
  if (status === 'warn') return 'text-amber-200';
  return 'text-emerald-300/90';
}

function statusWord(status: GuideStatus): string {
  if (status === 'block') return 'need';
  if (status === 'warn') return 'set';
  return 'ok';
}

export function ModelSettingsGuidePanel({
  model,
  settings,
  onSettingsChange,
  onOpenTab,
  compact,
}: Props) {
  const guide = buildModelSettingsGuide(model, settings);

  const applyAll = () => {
    const next = applyRecommendedApiSettings(settings, guide.model);
    setSettings(next);
    onSettingsChange(next);
  };

  const applyItem = (patch: Partial<GuideSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    onSettingsChange(next);
  };

  if (compact) {
    const alerts = guide.items.filter((i) => i.status !== 'ok');
    if (!alerts.length && !guide.applyPatch) return null;
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-zinc-950/80 px-3 py-1.5">
        <span className="font-mono text-[10px] text-zinc-400">
          {guide.klass.chip} · {guide.model}
        </span>
        {alerts.slice(0, 2).map((item) => (
          <span key={item.id} className={cn('font-mono text-[10px]', statusClass(item.status))}>
            {item.where}: {item.current}
          </span>
        ))}
        {guide.applyPatch ? (
          <button type="button" className="chip text-emerald-300" onClick={applyAll} title={guide.applyDetail}>
            {guide.applyLabel}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mb-3 rounded border border-border bg-zinc-950/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-wide text-muted">Settings for this model</div>
          <div className="mt-0.5 truncate font-mono text-xs text-zinc-100" title={guide.model}>
            {guide.model}
          </div>
          <p className="mt-1 font-mono text-[11px] leading-snug text-zinc-400">{guide.summary}</p>
        </div>
        <button
          type="button"
          disabled={!guide.applyPatch}
          onClick={applyAll}
          title={guide.applyDetail}
          className="shrink-0 rounded bg-zinc-100 px-2.5 py-1 font-mono text-[11px] font-medium text-zinc-900 hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          {guide.applyPatch ? guide.applyLabel : 'API settings applied'}
        </button>
      </div>
      {guide.applyPatch ? (
        <p className="mt-1 font-mono text-[10px] text-emerald-300/90">Click applies: {guide.applyDetail}</p>
      ) : (
        <p className="mt-1 font-mono text-[10px] text-muted">{guide.applyDetail}</p>
      )}

      <ul className="mt-2 divide-y divide-border/80 rounded border border-border/80">
        {guide.items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <div className={cn('font-mono text-[10px] uppercase', statusClass(item.status))}>
                {statusWord(item.status)} · {item.where}
              </div>
              <p className="mt-0.5 font-mono text-[11px] leading-snug text-zinc-300">{item.need}</p>
              <p className="font-mono text-[10px] text-muted">Now: {item.current}</p>
            </div>
            {item.fix?.kind === 'patch' && item.fixLabel ? (
              <button
                type="button"
                className="chip shrink-0"
                onClick={() => applyItem(item.fix && item.fix.kind === 'patch' ? item.fix.patch : {})}
              >
                {item.fixLabel}
              </button>
            ) : item.fix?.kind === 'open' && item.fixLabel && onOpenTab ? (
              <button type="button" className="chip shrink-0" onClick={() => onOpenTab(item.fix && item.fix.kind === 'open' ? item.fix.tab : 'api')}>
                {item.fixLabel}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ModelFamilyChip({ model }: { model: string }) {
  const klass = classifyModel(model);
  return (
    <span className="rounded border border-border px-1 py-px font-mono text-[9px] uppercase tracking-wide text-zinc-500">
      {klass.chip}
    </span>
  );
}
