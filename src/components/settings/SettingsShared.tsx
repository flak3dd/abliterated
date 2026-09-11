import { useEffect, useState, type ReactNode } from 'react';
import type { LicenseState } from '../../lib/license';
import {
  formatTokenCount,
  loadBuiltinUsage,
  loadWalletCache,
  remainingBuiltinTokens,
  refreshBuiltinWallet,
} from '../../lib/builtinTokens';
import type { ClientSettings } from '../../types';

export function Section({
  title,
  hint,
  children,
  danger,
  badge,
  action,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  danger?: boolean;
  badge?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section
      className={`rounded-[4px] border p-4 shadow-sm transition-colors ${
        danger
          ? 'border-rose-900/60 bg-rose-950/20'
          : 'border-zinc-800/80 bg-zinc-950/60'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/60 pb-3 mb-3.5">
        <div>
          <div className="flex items-center gap-2">
            <h2
              className={`font-mono text-[13px] font-bold tracking-tight ${
                danger ? 'text-rose-300' : 'text-zinc-100'
              }`}
            >
              {title}
            </h2>
            {badge}
          </div>
          {hint ? (
            <p className="mt-0.5 font-mono text-[11px] text-zinc-400">{hint}</p>
          ) : null}
        </div>
        {action ? <div className="flex items-center gap-2">{action}</div> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function FieldLabel({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block font-mono text-[10px] uppercase text-muted">
      <span className="font-semibold text-zinc-300">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint ? (
        <p className="mt-1 font-mono text-[11px] normal-case tracking-normal text-muted">
          {hint}
        </p>
      ) : null}
    </label>
  );
}

export function BuiltinTokenMeter({
  license,
  settings,
}: {
  license: LicenseState;
  settings: ClientSettings;
}) {
  const usage = loadBuiltinUsage();
  const [walletTick, setWalletTick] = useState(0);
  useEffect(() => {
    void refreshBuiltinWallet(settings).then(() => setWalletTick((n) => n + 1));
  }, [settings.licenseKey, settings.loginId, settings.billingSiteUrl, settings.deviceId]);
  const wallet = loadWalletCache();
  void walletTick;
  const cap = wallet
    ? wallet.includedRemaining + wallet.prepaidRemaining + Math.max(0, usage.used)
    : license.features.maxIncludedTokens;
  const used = wallet ? Math.max(0, cap - wallet.remaining) : usage.used;
  const left = remainingBuiltinTokens(license, usage);
  const pct = !Number.isFinite(cap) || cap <= 0 ? 0 : Math.min(100, Math.round((used / cap) * 100));

  return (
    <div className="mt-2 rounded-[4px] border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
          Built-in model token wallet
        </span>
        <span className="font-mono text-[11px] font-semibold text-zinc-200">
          {formatTokenCount(left)} left
        </span>
      </div>
      <div className="mt-1 font-mono text-[11px] text-zinc-400">
        {wallet
          ? `${formatTokenCount(wallet.includedRemaining)} included + ${formatTokenCount(wallet.prepaidRemaining)} prepaid`
          : `of ${formatTokenCount(cap)} (local estimate)`}
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-[2px] bg-zinc-800">
        <div
          className={`h-full transition-all duration-300 ${
            pct >= 100 ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-400' : 'bg-sky-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 font-mono text-[10px] text-zinc-500">
        Server wallet from /api/billing/wallet. Featherless BYOK does not count against this quota.
      </p>
    </div>
  );
}
