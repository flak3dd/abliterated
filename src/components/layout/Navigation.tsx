import { useState } from 'react';
import {
  Cpu,
  HardDrive,
  HelpCircle,
  ListTodo,
  MessageSquare,
  PanelLeft,
  Radio,
  Server,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import type { Tab } from '../../types';

const PRIMARY: { id: Tab; label: string; shortcut: string; icon: LucideIcon }[] = [
  { id: 'home', label: 'Chat', shortcut: '⌘1', icon: MessageSquare },
  { id: 'workspace', label: 'Workspace', shortcut: '⌘2', icon: HardDrive },
  { id: 'models', label: 'Models', shortcut: '⌘3', icon: Cpu },
  { id: 'jobs', label: 'Jobs', shortcut: '⌘4', icon: ListTodo },
  { id: 'api', label: 'API Endpoints', shortcut: '⌘5', icon: Radio },
  { id: 'vllm', label: 'vLLM', shortcut: '⌘6', icon: Server },
];

const SECONDARY: { id: Tab; label: string; shortcut: string; icon: LucideIcon }[] = [
  { id: 'settings', label: 'Settings', shortcut: '⌘7', icon: Settings },
];

const ITEMS = [...PRIMARY, ...SECONDARY];

const SIDEBAR_KEY = 'ablit_sidebar_collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

interface NavProps {
  current: Tab;
  onChange: (tab: Tab) => void;
  jobsActive?: boolean;
  onOpenShortcuts?: () => void;
  userName?: string;
  userSub?: string;
}

export function DesktopRail({
  current,
  onChange,
  jobsActive,
  onOpenShortcuts,
  userName = 'Local',
  userSub,
}: NavProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const initials = userName
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'AB';

  const renderRow = (item: (typeof ITEMS)[number]) => {
    const Icon = item.icon;
    const active = current === item.id;
    const showJobsDot = item.id === 'jobs' && jobsActive && !active;
    const isHovered = collapsed && hoveredId === item.id;

    return (
      <div key={item.id} className="relative">
        <button
          type="button"
          aria-label={item.label}
          aria-current={active ? 'page' : undefined}
          title={collapsed ? `${item.label} (${item.shortcut})` : undefined}
          onClick={() => onChange(item.id)}
          onMouseEnter={() => setHoveredId(item.id)}
          onMouseLeave={() => setHoveredId(null)}
          className={cn(
            'group relative flex w-full items-center gap-3 rounded-[4px] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            collapsed ? 'h-10 justify-center px-0' : 'px-3 py-2.5',
            active
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          )}
        >
          {active ? (
            <span
              className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-[2px] bg-primary"
              aria-hidden
            />
          ) : null}
          <span className="relative">
            <Icon
              className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-primary' : 'text-current')}
              strokeWidth={active ? 2 : 1.6}
            />
            {showJobsDot ? (
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-warn animate-pulse" aria-hidden />
            ) : null}
          </span>
          {collapsed ? null : <span className="truncate">{item.label}</span>}
        </button>
        {isHovered ? (
          <div className="pointer-events-none absolute left-full z-50 ml-3 flex items-center gap-1.5 whitespace-nowrap rounded-[3px] border border-border bg-panel px-2.5 py-1 text-[12px] text-foreground shadow-xl">
            <span>{item.label}</span>
            <span className="rounded-[2px] bg-surface px-1 py-0.5 font-mono text-[9px] text-muted-foreground">{item.shortcut}</span>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <nav
      className={cn(
        'hidden h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar select-none md:flex',
        collapsed ? 'w-16' : 'w-[248px]',
      )}
    >
      <div className={cn('flex items-center gap-2.5', collapsed ? 'justify-center px-2 py-4' : 'px-4 py-4')}>
        <button
          type="button"
          title="Abliterated — Chat (⌘1)"
          aria-label="Chat"
          onClick={() => onChange('home')}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] border border-sidebar-border bg-panel transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <img
            src={`${import.meta.env.BASE_URL}logo-skull-blue.png`}
            alt=""
            width={22}
            height={22}
            className="h-[22px] w-[22px] object-contain"
            draggable={false}
          />
        </button>
        {collapsed ? null : (
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold tracking-tight text-foreground">Abliterated</p>
            <p className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">local ide</p>
          </div>
        )}
      </div>

      <div className={cn('flex flex-1 flex-col gap-1 overflow-y-auto py-2', collapsed ? 'px-2' : 'px-2')}>
        {PRIMARY.map(renderRow)}
        <div className="my-2 h-px bg-sidebar-border" />
        {SECONDARY.map(renderRow)}
      </div>

      <div className={cn('flex flex-col gap-2 border-t border-sidebar-border', collapsed ? 'items-center p-2' : 'p-3')}>
        {collapsed ? null : (
          <div className="flex items-center gap-3 rounded-[4px] border border-sidebar-border bg-panel/60 px-3 py-2.5">
            <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-[4px] bg-primary/15 border border-primary/30 font-mono text-[11px] font-semibold text-primary">
              {initials}
              <span className="absolute -left-0.5 -top-0.5 h-2 w-2 rounded-[2px] bg-signal" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-foreground">{userName}</p>
              {userSub ? <p className="truncate text-[11px] text-muted-foreground">{userSub}</p> : null}
            </div>
          </div>
        )}
        <div className={cn('flex', collapsed ? 'flex-col gap-1' : 'items-center justify-between')}>
          {onOpenShortcuts ? (
            <button
              type="button"
              title="Keyboard shortcuts (?)"
              aria-label="Keyboard shortcuts"
              onClick={onOpenShortcuts}
              className="flex h-9 w-9 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            >
              <HelpCircle size={16} />
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={toggleCollapsed}
            className="flex h-9 w-9 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <PanelLeft size={16} className={collapsed ? 'rotate-180' : ''} />
          </button>
        </div>
      </div>
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
              'relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[9px] uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
              active ? 'text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {active ? (
              <span className="absolute inset-x-3 top-0 h-0.5 rounded-b bg-primary" aria-hidden />
            ) : null}
            <span className="relative">
              <Icon size={16} strokeWidth={active ? 2 : 1.75} />
              {showJobsDot ? (
                <span className="absolute -right-1.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-warn animate-pulse" aria-hidden />
              ) : null}
            </span>
            <span className="truncate max-w-[48px]">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
