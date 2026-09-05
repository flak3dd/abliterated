import { useEffect, useRef, useState } from 'react';
import { INFERENCE_PROVIDERS } from '../../lib/activeEndpoint';
import { cn } from '../../lib/cn';
import type { BridgeStatus } from '../../lib/bridgeClient';
import type { InferenceProvider } from '../../types';

interface Props {
  bridgeStatus: BridgeStatus;
  workspaceRoot: string;
  branch: string;
  isDirty: boolean;
  autoAcceptEdits: boolean;
  autoRunShell: boolean;
  agentLabel: string;
  providerLabel: string;
  provider: InferenceProvider;
  onProviderChange?: (p: InferenceProvider) => void;
  /** Free-tier soft watermark */
  showWatermark?: boolean;
  /** Shown when not Free (e.g. Admin (dev)). */
  licenseLabel?: string;
  onUpgradeClick?: () => void;
}

function basename(path: string): string {
  const s = path.trim().replace(/[/\\]+$/, '');
  if (!s) return '—';
  const parts = s.split(/[/\\]/);
  return parts[parts.length - 1] || s;
}

export function StatusBar({
  bridgeStatus,
  workspaceRoot,
  branch,
  isDirty,
  autoAcceptEdits,
  autoRunShell,
  agentLabel,
  providerLabel,
  provider,
  onProviderChange,
  showWatermark,
  licenseLabel,
  onUpgradeClick,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [menuOpen]);

  const bridgeColor =
    bridgeStatus === 'connected'
      ? 'text-emerald-400'
      : bridgeStatus === 'connecting'
        ? 'text-amber-400'
        : bridgeStatus === 'error'
          ? 'text-red-400'
          : 'text-zinc-500';

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 overflow-hidden border-t border-border bg-surface px-2 font-mono text-[10px] text-muted">
      <span className={cn('shrink-0', bridgeColor)}>bridge {bridgeStatus}</span>
      <span className="min-w-0 truncate" title={workspaceRoot || undefined}>
        {basename(workspaceRoot)}
      </span>
      {branch ? (
        <span className="shrink-0 truncate text-zinc-400">
          {branch}
          {isDirty ? '*' : ''}
        </span>
      ) : null}
      <span className="shrink-0">
        auto-accept {autoAcceptEdits ? 'on' : 'off'}
        <span className="mx-1 text-zinc-700">·</span>
        auto-run {autoRunShell ? 'on' : 'off'}
      </span>
      {providerLabel ? (
        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            title="Switch AI provider"
            onClick={(e) => {
              e.stopPropagation();
              if (!onProviderChange) return;
              setMenuOpen((o) => !o);
            }}
            className="rounded px-0.5 text-sky-400/90 hover:bg-zinc-800/80 hover:text-sky-300"
          >
            {providerLabel}
          </button>
          {menuOpen ? (
            <div
              className="absolute bottom-full left-0 z-50 mb-1 min-w-[9rem] rounded border border-border bg-surface py-0.5 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              {INFERENCE_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onProviderChange?.(p.id);
                    setMenuOpen(false);
                  }}
                  className={cn(
                    'block w-full px-2 py-1 text-left font-mono text-[10px]',
                    provider === p.id
                      ? 'bg-sky-500/15 text-sky-300'
                      : 'text-zinc-300 hover:bg-zinc-800',
                  )}
                >
                  {p.label}
                  {provider === p.id ? ' ✓' : ''}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {showWatermark ? (
        <button
          type="button"
          title="Upgrade to Pro"
          onClick={(e) => {
            e.stopPropagation();
            onUpgradeClick?.();
          }}
          className="shrink-0 rounded px-1 text-amber-400/80 hover:bg-zinc-800 hover:text-amber-300"
        >
          Free · Upgrade
        </button>
      ) : licenseLabel ? (
        <button
          type="button"
          title={licenseLabel}
          onClick={(e) => {
            e.stopPropagation();
            onUpgradeClick?.();
          }}
          className="shrink-0 rounded px-1 text-emerald-400/80 hover:bg-zinc-800 hover:text-emerald-300"
        >
          {licenseLabel}
        </button>
      ) : null}
      {agentLabel ? <span className="ml-auto shrink-0 text-amber-400/90">{agentLabel}</span> : <span className="ml-auto" />}
    </footer>
  );
}
