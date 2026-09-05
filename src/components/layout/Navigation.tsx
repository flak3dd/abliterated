import { useState } from 'react';
import { Cpu, HardDrive, HelpCircle, ImageIcon, ListTodo, Radio, Settings, Terminal } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { Tab } from '../../types';

const ITEMS: { id: Tab; label: string; shortcut: string; icon: typeof Terminal }[] = [
  { id: 'home', label: 'Sessions', shortcut: '⌘1', icon: Terminal },
  { id: 'workspace', label: 'Workspace', shortcut: '⌘2', icon: HardDrive },
  { id: 'models', label: 'Models', shortcut: '⌘3', icon: Cpu },
  { id: 'jobs', label: 'Jobs', shortcut: '⌘4', icon: ListTodo },
  { id: 'api', label: 'API Endpoints', shortcut: '⌘5', icon: Radio },
  { id: 'images', label: 'Images', shortcut: '⌘6', icon: ImageIcon },
  { id: 'settings', label: 'Settings', shortcut: '⌘7', icon: Settings },
];

interface NavProps {
  current: Tab;
  onChange: (tab: Tab) => void;
  /** Soft pulse on Jobs when a job is queued/running */
  jobsActive?: boolean;
  onOpenShortcuts?: () => void;
}

export function DesktopRail({ current, onChange, jobsActive, onOpenShortcuts }: NavProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <nav className="hidden md:flex w-16 shrink-0 flex-col items-center border-r border-border bg-surface py-3 select-none">
      {/* Brand Icon */}
      <button
        type="button"
        title="Abliterated IDE - Sessions (⌘1)"
        aria-label="Home"
        onClick={() => onChange('home')}
        className="group relative mb-4 flex h-9 w-9 items-center justify-center rounded-lg border border-border/80 bg-surface-raised transition-all duration-200 hover:border-sky-500/50 hover:shadow-glow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-500"
      >
        <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-sky-500/10 to-indigo-500/0 opacity-0 transition-opacity group-hover:opacity-100" />
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-zinc-100 transition-transform group-hover:scale-105">
          <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400" />
          <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400" />
        </svg>
      </button>

      {/* Navigation Items */}
      <div className="flex flex-1 flex-col gap-1.5 w-full items-center">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const active = current === item.id;
          const showJobsDot = item.id === 'jobs' && jobsActive && !active;
          const isHovered = hoveredId === item.id;

          return (
            <div key={item.id} className="relative flex items-center justify-center w-full">
              <button
                type="button"
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                onClick={() => onChange(item.id)}
                onMouseEnter={() => setHoveredId(item.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={cn(
                  'relative flex h-10 w-10 items-center justify-center rounded-lg transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400',
                  active
                    ? 'bg-zinc-800/90 text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
                    : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200',
                )}
              >
                {active ? (
                  <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-md bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.6)]" aria-hidden />
                ) : null}
                <Icon size={17} strokeWidth={active ? 2 : 1.75} />
                {showJobsDot ? (
                  <span
                    className="absolute right-2 top-2 h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] animate-pulse"
                    aria-hidden
                  />
                ) : null}
              </button>

              {/* Tooltip Overlay */}
              {isHovered ? (
                <div
                  className="absolute left-full ml-3 z-50 flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-surface-raised px-2.5 py-1 font-mono text-[11px] text-zinc-200 shadow-xl backdrop-blur-md pointer-events-none modal-animate-in"
                >
                  <span>{item.label}</span>
                  <span className="rounded bg-surface px-1 py-0.5 text-[9px] text-zinc-400 border border-border-subtle">{item.shortcut}</span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Keyboard Shortcuts Trigger */}
      {onOpenShortcuts ? (
        <div className="relative flex items-center justify-center w-full mt-auto pt-2 border-t border-border/50">
          <button
            type="button"
            title="Keyboard Shortcuts (?)"
            aria-label="Keyboard Shortcuts"
            onClick={onOpenShortcuts}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
          >
            <HelpCircle size={16} />
          </button>
        </div>
      ) : null}
    </nav>
  );
}

export function BottomNav({ current, onChange, jobsActive }: NavProps) {
  return (
    <nav className="md:hidden flex shrink-0 items-stretch border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] select-none">
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const active = current === item.id;
        const showJobsDot = item.id === 'jobs' && jobsActive && !active;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={cn(
              'relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[9px] uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zinc-500',
              active ? 'text-zinc-100 font-semibold' : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            {active ? (
              <span className="absolute inset-x-3 top-0 h-0.5 rounded-b bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.7)]" aria-hidden />
            ) : null}
            <span className="relative">
              <Icon size={16} strokeWidth={active ? 2 : 1.75} />
              {showJobsDot ? (
                <span className="absolute -right-1.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" aria-hidden />
              ) : null}
            </span>
            <span className="truncate max-w-[48px]">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
