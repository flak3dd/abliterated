import { useId, type ReactNode } from 'react';
import type { ToggleGuidance } from '../../lib/agentPresets';

export interface ToggleSwitchProps {
  id?: string;
  label: string;
  help?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
  danger?: boolean;
  guidance?: ToggleGuidance;
  onAlign?: () => void;
  badge?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function ToggleSwitch({
  id: explicitId,
  label,
  help,
  checked,
  onChange,
  disabled = false,
  disabledReason,
  danger = false,
  guidance,
  onAlign,
  badge,
  icon,
  className = '',
}: ToggleSwitchProps) {
  const generatedId = useId();
  const id = explicitId || generatedId;

  const handleToggle = () => {
    if (disabled) return;
    onChange(!checked);
  };

  const isDivergent = guidance && !guidance.isAligned;

  return (
    <div
      className={`relative rounded-lg border transition-all duration-200 ${
        disabled
          ? 'cursor-not-allowed border-zinc-800/60 bg-zinc-950/40 opacity-60'
          : checked
            ? danger
              ? 'border-rose-900/60 bg-rose-950/20 shadow-[0_0_20px_rgba(244,63,94,0.08)]'
              : 'border-emerald-500/30 bg-emerald-950/15 shadow-[0_0_20px_rgba(16,185,129,0.07)] hover:border-emerald-500/40'
            : isDivergent
              ? 'border-amber-900/50 bg-zinc-950/80 hover:border-amber-700/60'
              : 'border-zinc-800/80 bg-zinc-950/60 hover:border-zinc-700/80 hover:bg-zinc-900/40'
      } p-3.5 ${className}`}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Label and Info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {icon ? <span className="text-zinc-400 shrink-0">{icon}</span> : null}
            <label
              htmlFor={id}
              onClick={handleToggle}
              className={`cursor-pointer select-none font-mono text-[13px] font-medium leading-5 transition-colors ${
                disabled
                  ? 'cursor-not-allowed text-zinc-500'
                  : checked
                    ? danger
                      ? 'text-rose-200'
                      : 'text-zinc-100'
                    : 'text-zinc-300 hover:text-white'
              }`}
            >
              {label}
            </label>

            {badge ? <span className="shrink-0">{badge}</span> : null}

            {/* Contextual Setup Guidance Chip */}
            {guidance ? (
              guidance.isAligned ? (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] transition-colors ${
                    checked
                      ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                      : 'bg-zinc-900/90 text-zinc-400 border border-zinc-800'
                  }`}
                  title={guidance.tooltip}
                >
                  <span className={`h-1 w-1 rounded-full ${checked ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
                  {guidance.badgeLabel}
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-800/60 bg-amber-950/60 px-2 py-0.5 font-mono text-[10px] text-amber-300"
                  title={guidance.tooltip}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
                  {guidance.badgeLabel}
                  {onAlign ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAlign();
                      }}
                      className="ml-0.5 rounded bg-amber-500/20 px-1 py-0.2 text-[9px] font-semibold text-amber-200 underline transition-colors hover:bg-amber-500/30 hover:text-white"
                      title="Set to setup recommendation"
                    >
                      Align
                    </button>
                  ) : null}
                </span>
              )
            ) : null}
          </div>

          {help ? (
            <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-zinc-400/90">
              {help}
            </p>
          ) : null}

          {/* Locked / Disabled Reason Alert */}
          {disabled && disabledReason ? (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded border border-amber-900/50 bg-amber-950/30 px-2 py-1 font-mono text-[11px] text-amber-300/90">
              <span className="text-[10px]">🔒</span>
              <span>{disabledReason}</span>
            </div>
          ) : null}
        </div>

        {/* The Modern Pill Switch & Status Indicator */}
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {/* Status Badge */}
          <span
            className={`select-none font-mono text-[10px] font-bold uppercase tracking-wider transition-colors ${
              disabled
                ? 'text-zinc-600'
                : checked
                  ? danger
                    ? 'text-rose-400'
                    : 'text-emerald-400'
                  : 'text-zinc-500'
            }`}
          >
            {checked ? (
              <span className="inline-flex items-center gap-1">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    danger ? 'bg-rose-400' : 'bg-emerald-400'
                  }`}
                />
                ON
              </span>
            ) : (
              'OFF'
            )}
          </span>

          {/* Toggle Button */}
          <button
            id={id}
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={handleToggle}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
              disabled
                ? 'cursor-not-allowed bg-zinc-800'
                : checked
                  ? danger
                    ? 'bg-rose-600 shadow-[0_0_12px_rgba(244,63,94,0.45)] focus-visible:ring-rose-500'
                    : 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)] focus-visible:ring-emerald-400'
                  : 'bg-zinc-800 hover:bg-zinc-700/90 focus-visible:ring-zinc-400'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200 ease-out ${
                checked ? 'translate-x-6' : 'translate-x-1'
              } ${disabled ? 'bg-zinc-400' : ''}`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
