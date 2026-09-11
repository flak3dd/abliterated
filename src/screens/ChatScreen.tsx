import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowDown,
  RotateCcw,
  Send,
  Square,
  Play,
  Zap,
  ChevronDown,
  FolderTree,
  Pencil,
  MoreHorizontal,
  Download,
  Check,
  Terminal,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { DEEPEN_COMPLETENESS_CHAT_LABEL, DEEPEN_COMPLETENESS_TOOLTIP } from '../lib/deepenComplete';
import { MessageBubble } from '../components/chat/MessageBubble';
import { AgentStatusMonitor } from '../components/chat/AgentStatusMonitor';
import { WorkingDirPrompt } from '../components/chat/WorkingDirPrompt';
import { resolveActiveSettings } from '../lib/activeEndpoint';
import { downloadFilesAsZip, extractFilesFromMarkdown } from '../lib/zipDownload';
import { ProofChip } from '../components/chat/ProofChip';
import { enqueueChatAsJob } from '../lib/jobRunner';
import { ModelSettingsGuidePanel } from '../components/common/ModelSettingsGuide';
import { FileAutocompletePopup } from '../components/chat/FileAutocompletePopup';
import type { ClientSettings, Tab, Thread, AgentMode } from '../types';
import { ALL_AGENT_MODES } from '../types';
import { MESSAGE_WINDOW, useAgentLoop } from '../hooks/useAgentLoop';

export interface ChatScreenHandle {
  stop: () => void;
  retry: () => Promise<void>;
  continueAfterTool: (messageId: string) => Promise<void>;
  fillInput: (text: string) => void;
  focusInput: () => void;
}

interface Props {
  thread: Thread;
  settings: ClientSettings;
  autoAcceptEdits: boolean;
  autoRunShell: boolean;
  workspaceRoot: string;
  onChooseWorkspace?: (path: string) => Promise<void>;
  onBack: () => void;
  onThreadUpdate: (thread: Thread) => void;
  onAgentStatus?: (label: string) => void;
  onGitMaybeChanged?: () => void;
  composerSeed?: string | null;
  onComposerSeedConsumed?: () => void;
  planMode?: boolean;
  buildMode?: boolean;
  agentMode?: AgentMode;
  onTogglePlanMode?: () => void;
  onToggleBuildMode?: () => void;
  onSelectAgentMode?: (mode: AgentMode) => void;
  onApprovePlan?: () => void;
  /** Persist ClientSettings patches (Completeness toggle syncs with Settings/Jobs). */
  onSettingsChange?: (s: ClientSettings) => void;
  onOpenTab?: (tab: Tab) => void;
  filePanelOpen?: boolean;
  onToggleFilePanel?: () => void;
}

type QuickAction = {
  id: string;
  label: string;
  fill?: string;
  send?: string;
};

const QUICK_ACTIONS: QuickAction[] = [
  { id: 'git-status', label: 'git status', send: 'Run git_status and summarize the working tree.' },
  { id: 'search', label: 'search', fill: 'semantic_search ' },
  { id: 'grep', label: 'grep', fill: 'grep for ' },
  { id: 'find', label: 'find files', fill: 'glob **/*.ts' },
  { id: 'read', label: 'read file', fill: 'read_file ' },
  { id: 'commit', label: 'commit', fill: 'git_commit with message: ' },
  {
    id: 'fix-tests',
    label: 'fix failing tests',
    send: 'Find failing tests, read the failures, fix with a minimal ```diff, then verify.',
  },
];

function QuickChips({
  onFill,
  onSend,
}: {
  onFill: (text: string) => void;
  onSend: (text: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {QUICK_ACTIONS.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => {
            if (a.send) onSend(a.send);
            else if (a.fill) onFill(a.fill);
          }}
          className="chip"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

/** Compact toggle: shows a ⚡ button that reveals QuickChips inline on click. */
function QuickChipsToggle({
  onFill,
  onSend,
}: {
  onFill: (text: string) => void;
  onSend: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-background px-2 py-0.5 font-mono text-[10px] text-zinc-400 transition-colors hover:border-primary/40 hover:text-zinc-200"
        title="Quick actions"
      >
        <Zap size={10} /> Quick
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="inline-flex shrink-0 items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary transition-colors hover:bg-primary/20"
        title="Hide quick actions"
      >
        <Zap size={10} /> Quick
      </button>
      {QUICK_ACTIONS.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => {
            if (a.send) onSend(a.send);
            else if (a.fill) onFill(a.fill);
            setOpen(false);
          }}
          className="chip"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

/** Unified mode indicator — replaces 4 separate bars with a single compact strip. */
function ModeIndicator({
  mode,
  planChecklist,
  busy,
  onApprovePlan,
  onCancelPlan,
}: {
  mode: AgentMode;
  planChecklist: string[];
  busy: boolean;
  onApprovePlan: () => void;
  onCancelPlan: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (mode === 'plan') {
    return (
      <div className="border-t border-sky-800/40 bg-sky-950/20 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-2 text-left font-mono text-[10px] text-sky-300"
        >
          <span>📋</span>
          <span className="flex-1">
            Plan mode{planChecklist.length ? ` · ${planChecklist.length} steps` : ''} · writes locked
          </span>
          <ChevronDown size={12} className={cn('transition-transform text-sky-400', expanded && 'rotate-180')} />
        </button>
        {expanded ? (
          <div className="mt-1.5">
            {planChecklist.length ? (
              <ul className="max-h-28 space-y-0.5 overflow-auto font-mono text-[11px] text-zinc-300">
                {planChecklist.map((item, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="shrink-0 text-muted">{i + 1}.</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="font-mono text-[10px] text-muted">
                Waiting for a checklist…
              </div>
            )}
            <div className="mt-1.5 flex gap-2">
              <button
                type="button"
                disabled={!planChecklist.length || busy}
                className="btn-primary font-mono text-[10px] disabled:opacity-40"
                onClick={onApprovePlan}
              >
                Approve plan
              </button>
              <button type="button" className="btn-ghost font-mono text-[10px]" onClick={onCancelPlan}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (mode === 'ask') {
    return (
      <div className="border-t border-emerald-800/40 bg-emerald-950/15 px-3 py-1 font-mono text-[10px] text-emerald-300">
        🔍 Ask mode — read-only
      </div>
    );
  }

  if (mode === 'debug') {
    return (
      <div className="border-t border-amber-800/40 bg-amber-950/15 px-3 py-1 font-mono text-[10px] text-amber-300">
        🐛 Debug — reproduce → isolate → fix → verify
      </div>
    );
  }

  // Agent mode with optional ToDo checklist
  if (planChecklist.length > 0) {
    return (
      <div className="border-t border-zinc-800/60 bg-zinc-950/40 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-2 text-left font-mono text-[10px] text-zinc-400"
        >
          <span>📝</span>
          <span className="flex-1">{planChecklist.length} todo items</span>
          <ChevronDown size={12} className={cn('transition-transform text-zinc-500', expanded && 'rotate-180')} />
        </button>
        {expanded ? (
          <ul className="mt-1 max-h-28 space-y-0.5 overflow-auto font-mono text-[11px] text-zinc-300">
            {planChecklist.map((item, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="shrink-0 text-muted">{i + 1}.</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return null;
}

export const ChatScreen = forwardRef<ChatScreenHandle, Props>(function ChatScreen(
  {
    thread,
    settings,
    autoAcceptEdits,
    autoRunShell,
    workspaceRoot,
    onChooseWorkspace,
    onBack,
    onThreadUpdate,
    onAgentStatus,
    onGitMaybeChanged,
    composerSeed,
    onComposerSeedConsumed,
    planMode = false,
    buildMode = false,
    agentMode,
    onTogglePlanMode,
    onSelectAgentMode,
    onApprovePlan,
    onSettingsChange,
    onOpenTab,
    filePanelOpen = false,
    onToggleFilePanel,
  },
  ref,
) {
  const {
    messages,
    messagesRef,
    hiddenPrefix,
    setHiddenPrefix,
    input,
    setInput,
    busy,
    loopTurn,
    maxTurns,
    lastProof,
    bridgeStatus,
    appRoot,
    setDirConfirmed,
    needsWorkingDir,
    grokById,
    grokHeader: _grokHeader,
    planChecklist,
    agentPhase,
    phaseMeta,
    showIdleMonitor,
    queuedMidRun,
    showJump,
    statusLabel,
    agentProfile: _agentProfile,
    effectiveTools: _effectiveTools,
    completenessOn,
    runStartedAtRef,
    scrollerRef,
    inputRef,
    persist,
    scrollToBottom,
    sendText,
    send,
    stop,
    retry,
    fillInput,
    continueAfterTool,
    handleGitCommit,
    handleCreatePr,
    handleCheckpointRestore,
    restoreCheckpointById,
    handleWriteFile,
    handleShellExecuted,
    handleContinuePrompt,
    patchDeepenCompleteness,
    deepenThisAnswerNow: _deepenThisAnswerNow,
  } = useAgentLoop({
    thread,
    settings,
    autoAcceptEdits,
    autoRunShell,
    workspaceRoot,
    onThreadUpdate,
    onAgentStatus,
    onGitMaybeChanged,
    composerSeed,
    onComposerSeedConsumed,
    planMode,
    buildMode,
    agentMode,
    onSettingsChange,
  });

  const [autocompleteQuery, setAutocompleteQuery] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(thread.title);
  const [showThreadMenu, setShowThreadMenu] = useState(false);

  useEffect(() => {
    setTitleDraft(thread.title);
    setIsEditingTitle(false);
  }, [thread.id, thread.title]);

  useImperativeHandle(
    ref,
    () => ({
      stop,
      retry,
      continueAfterTool,
      fillInput,
      focusInput: () => {
        inputRef.current?.focus();
      },
    }),
    [stop, retry, continueAfterTool, fillInput, inputRef],
  );

  const currentMode: AgentMode = agentMode || settings.agentMode || (planMode ? 'plan' : 'agent');

  const handleModeSelect = (mode: AgentMode) => {
    if (onSelectAgentMode) {
      onSelectAgentMode(mode);
    } else if (onSettingsChange) {
      onSettingsChange({
        ...settings,
        agentMode: mode,
        planModeEnabled: mode === 'plan',
        buildModeEnabled: mode === 'agent',
      });
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inputRef]);

  // Dynamic textarea height calculation
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      const scrollH = inputRef.current.scrollHeight;
      const targetH = Math.min(Math.max(scrollH, 44), 160);
      inputRef.current.style.height = `${targetH}px`;
    }
  }, [input, inputRef]);

  const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl+K';
  const midRunOn = settings.midRunInjectEnabled !== false;
  const thoughtOn = settings.reasoning !== 'off';
  const placeholder = needsWorkingDir
    ? 'Choose a working directory first'
    : busy
    ? midRunOn
      ? 'Agent is executing… type a note to steer mid-run'
      : 'Agent busy — Stop to cancel'
    : planMode
      ? 'Plan mode — checklist only (no diffs) · Enter send'
      : buildMode
        ? 'Build mode — ToDo then diffs in content · Enter send'
        : thoughtOn
          ? 'Thought on — Goal/Inspect/Steps in reasoning · Enter send'
          : `Message · @file pin · ${modKey} commands · Enter send`;

  const completionFooterEnabled = useMemo(
    () => settings.completionFooterEnabled !== false,
    [settings.completionFooterEnabled],
  );

  const handleApprovePlan = useCallback(() => {
    const host = messagesRef.current.find((x) => x.planApproved === 'awaiting');
    if (host) persist({ ...host, planApproved: 'approved' });
    onApprovePlan?.();
    if (!onApprovePlan) onTogglePlanMode?.();
  }, [messagesRef, persist, onApprovePlan, onTogglePlanMode]);

  const handleDeclinePlan = useCallback(() => {
    onTogglePlanMode?.();
  }, [onTogglePlanMode]);

  const handleOpenFile = useCallback((path: string) => {
    fillInput(`@${path} `);
    if (!filePanelOpen) onToggleFilePanel?.();
  }, [fillInput, filePanelOpen, onToggleFilePanel]);

  const saveTitle = useCallback(() => {
    setIsEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== thread.title) {
      onThreadUpdate({ ...thread, title: trimmed });
    } else {
      setTitleDraft(thread.title);
    }
  }, [titleDraft, thread, onThreadUpdate]);

  const cancelTitle = useCallback(() => {
    setIsEditingTitle(false);
    setTitleDraft(thread.title);
  }, [thread.title]);

  const handleExportMarkdown = useCallback(() => {
    const lines: string[] = [`# ${thread.title}\n`];
    for (const m of messages) {
      lines.push(`### ${m.role === 'user' ? 'User' : 'Assistant'} (${new Date(m.createdAt).toLocaleTimeString()})\n`);
      lines.push(m.content);
      lines.push('\n---\n');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${thread.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'transcript'}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setShowThreadMenu(false);
  }, [thread.title, messages]);

  const handleExportJson = useCallback(() => {
    const data = JSON.stringify(thread, null, 2);
    const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${thread.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'thread'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setShowThreadMenu(false);
  }, [thread]);

  const handleExportZip = useCallback(() => {
    const allFiles = messages
      .filter((m) => m.role === 'assistant')
      .flatMap((m) => extractFilesFromMarkdown(m.content));
    if (allFiles.length > 0) {
      const slug = thread.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'chat';
      downloadFilesAsZip(`${slug}-code-files`, allFiles);
    }
    setShowThreadMenu(false);
  }, [thread.title, messages]);

  const checkAutocompleteCursor = useCallback((val: string, cursorIndex: number) => {
    const left = val.slice(0, cursorIndex);
    const match = left.match(/@([a-zA-Z0-9_./\\-]*)$/);
    if (match) {
      setAutocompleteQuery(match[1]);
    } else {
      setAutocompleteQuery(null);
    }
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    const cursor = e.target.selectionStart ?? val.length;
    checkAutocompleteCursor(val, cursor);
  }, [setInput, checkAutocompleteCursor]);

  const handleTextareaCursorCheck = useCallback(() => {
    if (!inputRef.current) return;
    const val = inputRef.current.value;
    const cursor = inputRef.current.selectionStart ?? val.length;
    checkAutocompleteCursor(val, cursor);
  }, [inputRef, checkAutocompleteCursor]);

  const handleSelectAutocomplete = useCallback((filePath: string) => {
    if (!inputRef.current) return;
    const val = inputRef.current.value;
    const selStart = inputRef.current.selectionStart ?? val.length;
    const left = val.slice(0, selStart);
    const right = val.slice(selStart);
    const match = left.match(/@([a-zA-Z0-9_./\\-]*)$/);
    if (match) {
      const newLeft = left.slice(0, match.index) + `@${filePath} `;
      const nextVal = newLeft + right;
      setInput(nextVal);
      setAutocompleteQuery(null);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          const newPos = newLeft.length;
          inputRef.current.setSelectionRange(newPos, newPos);
        }
      }, 0);
    }
  }, [inputRef, setInput]);

  const composerModeGlow = useMemo(() => {
    switch (currentMode) {
      case 'plan':
        return 'focus-within:border-sky-500/70 focus-within:shadow-[0_0_24px_-4px_rgba(14,165,233,0.3)]';
      case 'ask':
        return 'focus-within:border-emerald-500/70 focus-within:shadow-[0_0_24px_-4px_rgba(16,185,129,0.3)]';
      case 'debug':
        return 'focus-within:border-amber-500/70 focus-within:shadow-[0_0_24px_-4px_rgba(245,158,11,0.3)]';
      default:
        return 'focus-within:border-primary/70 focus-within:shadow-[0_0_24px_-4px_rgba(99,102,241,0.3)]';
    }
  }, [currentMode]);

  const activeSettings = useMemo(() => resolveActiveSettings(settings), [settings]);

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex items-center gap-2.5 border-b border-border bg-background/80 px-4 py-3 backdrop-blur">
        <button
          type="button"
          onClick={onBack}
          className="rounded-[3px] p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          {isEditingTitle ? (
            <div className="flex items-center gap-1.5 py-0.5">
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveTitle();
                  else if (e.key === 'Escape') cancelTitle();
                }}
                onBlur={saveTitle}
                autoFocus
                className="w-full max-w-sm rounded-[3px] border border-primary/50 bg-surface px-2 py-0.5 text-[16px] font-semibold text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                onClick={saveTitle}
                className="rounded-[2px] p-1 text-emerald-400 hover:bg-emerald-950/40"
                title="Save title"
              >
                <Check size={14} />
              </button>
            </div>
          ) : (
            <div
              className="group flex items-center gap-1.5 cursor-pointer"
              onClick={() => setIsEditingTitle(true)}
              title="Click to rename session"
            >
              <div className="truncate text-[18px] font-semibold tracking-tight text-foreground transition-colors group-hover:text-primary">
                {thread.title}
              </div>
              <Pencil
                size={12}
                className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
              />
            </div>
          )}
          <div className="truncate font-mono text-[10.5px] text-muted-foreground">
            {activeSettings.label} · {statusLabel}
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-1.5 rounded-[3px] border border-border bg-surface/80 px-2 py-0.5 font-mono text-[10px] text-zinc-300">
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              bridgeStatus === 'connected' ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-amber-400',
            )}
          />
          <span className="truncate max-w-[150px] font-medium text-zinc-200">
            {activeSettings.defaultModel || 'Spark / grok'}
          </span>
        </div>

        <button
          type="button"
          onClick={() => void retry()}
          disabled={busy}
          className="rounded-[3px] p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          title="Retry turn"
        >
          <RotateCcw size={14} />
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowThreadMenu((v) => !v)}
            aria-label="Thread actions"
            className="rounded-[3px] p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MoreHorizontal size={16} />
          </button>
          {showThreadMenu ? (
            <div className="absolute right-0 top-full mt-1.5 z-50 w-44 rounded-[4px] border border-border bg-panel/95 p-1 font-mono text-[11px] shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100">
              <button
                type="button"
                onClick={() => {
                  setShowThreadMenu(false);
                  setIsEditingTitle(true);
                }}
                className="flex w-full items-center gap-2 rounded-[2px] px-2.5 py-1.5 text-left text-zinc-300 hover:bg-accent hover:text-foreground"
              >
                <Pencil size={12} className="text-zinc-400" />
                <span>Rename session</span>
              </button>
              <button
                type="button"
                onClick={handleExportMarkdown}
                className="flex w-full items-center gap-2 rounded-[2px] px-2.5 py-1.5 text-left text-zinc-300 hover:bg-accent hover:text-foreground"
              >
                <Download size={12} className="text-zinc-400" />
                <span>Export Markdown</span>
              </button>
              <button
                type="button"
                onClick={handleExportJson}
                className="flex w-full items-center gap-2 rounded-[2px] px-2.5 py-1.5 text-left text-zinc-300 hover:bg-accent hover:text-foreground"
              >
                <Download size={12} className="text-zinc-400" />
                <span>Export JSON</span>
              </button>
              <button
                type="button"
                onClick={handleExportZip}
                className="flex w-full items-center gap-2 rounded-[2px] px-2.5 py-1.5 text-left text-zinc-300 hover:bg-accent hover:text-foreground"
              >
                <Download size={12} className="text-zinc-400" />
                <span>Export Code Files (.ZIP)</span>
              </button>
            </div>
          ) : null}
        </div>

        {onToggleFilePanel ? (
          <button
            type="button"
            aria-label={filePanelOpen ? 'Switch to chat sessions' : 'Switch to workspace file tree'}
            title={filePanelOpen ? 'Show chat sessions' : 'Show workspace file tree'}
            aria-pressed={filePanelOpen}
            onClick={onToggleFilePanel}
            className={cn(
              'rounded-[3px] p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground inline-flex',
              filePanelOpen && 'bg-accent text-foreground',
            )}
          >
            <FolderTree size={16} />
          </button>
        ) : null}
      </header>
      {onSettingsChange ? (
        <ModelSettingsGuidePanel
          compact
          model={activeSettings.defaultModel}
          settings={settings}
          onSettingsChange={onSettingsChange}
          onOpenTab={onOpenTab}
        />
      ) : null}

      <div
        className={cn(
          'chat-terminal flex flex-1 flex-col overflow-hidden',
          currentMode === 'plan' ? 'chat-terminal--plan' : currentMode === 'ask' ? 'chat-terminal--discuss' : 'chat-terminal--build',
        )}
      >
        <div className="chat-terminal-bg" aria-hidden="true" />
        <div ref={scrollerRef} className="relative z-[1] h-full overflow-auto px-4 py-3">
          {messages.length === 0 ? (
            <div className="mx-auto max-w-md space-y-4 py-8">
              {needsWorkingDir && onChooseWorkspace ? (
                <WorkingDirPrompt
                  appRoot={appRoot}
                  currentRoot={workspaceRoot}
                  onChoose={async (path) => {
                    await onChooseWorkspace(path);
                    setDirConfirmed(true);
                  }}
                />
              ) : (
                <>
                  <div className="text-center text-lg font-semibold tracking-tight text-foreground">Ready when you are</div>
                  <ul className="space-y-1.5 text-[13px] leading-5 text-muted-foreground">
                    <li>
                      · Pin context with <span className="text-zinc-300">@src/path.ts</span>
                    </li>
                    <li>· Send mid-run to steer the agent (when enabled in Settings)</li>
                    <li>· Tap Continue chips after a Done footer</li>
                    <li>· Quick chips fill or send common tool prompts</li>
                  </ul>
                  {!busy ? <QuickChips onFill={fillInput} onSend={(t) => void sendText(t)} /> : null}
                </>
              )}
            </div>
          ) : (
            <>
              {hiddenPrefix > 0 ? (
                <div className="mb-3 flex justify-center">
                  <button
                    type="button"
                    className="rounded border border-border bg-surface px-3 py-1 font-mono text-[10px] text-zinc-300 hover:border-zinc-500"
                    onClick={() => setHiddenPrefix((n) => Math.max(0, n - MESSAGE_WINDOW))}
                  >
                    Load earlier messages ({hiddenPrefix} hidden)
                  </button>
                </div>
              ) : null}
              {messages.slice(hiddenPrefix).map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  autoAcceptEdits={autoAcceptEdits}
                  autoRunShell={autoRunShell}
                  writesLocked={currentMode === 'plan' || currentMode === 'ask'}
                  terminalTone={currentMode === 'plan' ? 'plan' : currentMode === 'ask' ? 'discuss' : 'build'}
                  grokResults={grokById[m.id]}
                  bridgeConnected={bridgeStatus === 'connected'}
                  onGitCommit={handleGitCommit}
                  onCreatePr={handleCreatePr}
                  onCheckpointRestore={handleCheckpointRestore}
                  onRestoreCheckpointById={restoreCheckpointById}
                  onWriteFile={handleWriteFile}
                  onShellExecuted={handleShellExecuted}
                  completionFooterEnabled={completionFooterEnabled}
                  onContinuePrompt={handleContinuePrompt}
                  onFillPrompt={fillInput}
                  skipHighlight={m.status === 'streaming'}
                  onApprovePlan={handleApprovePlan}
                  onDeclinePlan={handleDeclinePlan}
                  onOpenFile={handleOpenFile}
                />
              ))}
            </>
          )}
        </div>
        {showJump ? (
          <button
            type="button"
            onClick={() => scrollToBottom(true)}
            className="absolute bottom-3 left-1/2 z-[1] inline-flex -translate-x-1/2 items-center gap-1 rounded-[3px] border border-border bg-surface/95 px-3 py-1 font-mono text-[10px] text-zinc-200 shadow-lg backdrop-blur hover:border-zinc-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500"
          >
            <ArrowDown size={11} /> Jump to latest
          </button>
        ) : null}
      </div>

      <ModeIndicator
        mode={currentMode}
        planChecklist={planChecklist}
        busy={busy}
        onApprovePlan={() => {
          onApprovePlan?.();
          if (!onApprovePlan) onTogglePlanMode?.();
        }}
        onCancelPlan={() => onTogglePlanMode?.()}
      />
      {needsWorkingDir && messages.length > 0 && onChooseWorkspace ? (
        <div className="border-t border-border bg-surface px-3 py-3">
          <WorkingDirPrompt
            appRoot={appRoot}
            currentRoot={workspaceRoot}
            onChoose={async (path) => {
              await onChooseWorkspace(path);
              setDirConfirmed(true);
            }}
          />
        </div>
      ) : null}
      <form
        className="bg-transparent px-3 pb-3 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {busy || showIdleMonitor ? (
          <AgentStatusMonitor
            phase={busy ? agentPhase : agentPhase === 'idle' ? 'stopped' : agentPhase}
            meta={phaseMeta}
            turn={busy ? loopTurn : 0}
            maxTurns={maxTurns}
            queuedMidRun={queuedMidRun}
            runStartedAt={busy ? (runStartedAtRef.current || phaseMeta.runStartedAt) : phaseMeta.runStartedAt}
            ticking={busy}
            compact={!busy && showIdleMonitor}
          />
        ) : null}
        {!busy && lastProof ? (
          <ProofChip proof={lastProof} className="mb-1" />
        ) : null}
        <div className={cn("relative mx-auto max-w-3xl rounded-[4px] border border-border bg-zinc-950/95 shadow-sm transition-all", composerModeGlow)}>
          {autocompleteQuery !== null ? (
            <FileAutocompletePopup
              query={autocompleteQuery}
              workspaceRoot={workspaceRoot}
              onSelect={handleSelectAutocomplete}
              onClose={() => setAutocompleteQuery(null)}
            />
          ) : null}
          <div className="flex flex-col">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onClick={handleTextareaCursorCheck}
              onKeyUp={handleTextareaCursorCheck}
              onKeyDown={(e) => {
                if (autocompleteQuery !== null && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter' || e.key === 'Tab')) {
                  // Navigation handled by FileAutocompletePopup
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={placeholder}
              disabled={needsWorkingDir}
              className="w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground border-0 focus-visible:ring-0 overflow-y-auto"
              style={{ minHeight: '44px', maxHeight: '160px' }}
            />
            <div className="flex flex-wrap items-end gap-2 px-3 pb-2.5 pt-1">
              <label
                className={
                  'flex shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-[2px] border px-2 py-0.5 font-mono text-[10px] ' +
                  (completenessOn
                    ? 'border-emerald-600/70 bg-emerald-950/40 text-emerald-300'
                    : 'border-border bg-background text-muted')
                }
                title={DEEPEN_COMPLETENESS_TOOLTIP}
              >
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={completenessOn}
                  aria-label={DEEPEN_COMPLETENESS_CHAT_LABEL}
                  checked={completenessOn}
                  onChange={() => patchDeepenCompleteness(!completenessOn)}
                  className="h-3 w-3 accent-emerald-400"
                />
                {DEEPEN_COMPLETENESS_CHAT_LABEL}
              </label>
              <label
                className={cn(
                  'flex shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-[2px] border px-2 py-0.5 font-mono text-[10px] transition-colors',
                  autoRunShell
                    ? 'border-amber-500/70 bg-amber-950/40 text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.15)]'
                    : 'border-border bg-background text-muted hover:border-zinc-700',
                )}
                title="Automatically execute code fences and shell commands via localhost bridge without manual confirm gating"
              >
                <Terminal size={11} className={autoRunShell ? 'text-amber-400' : 'text-zinc-500'} />
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={autoRunShell}
                  aria-label="Auto-run Code"
                  checked={autoRunShell}
                  onChange={() => {
                    onSettingsChange?.({
                      ...settings,
                      autoRunShell: !autoRunShell,
                    });
                  }}
                  className="h-3 w-3 accent-amber-400"
                />
                <span>Auto-run Code</span>
              </label>
              <div className="flex items-center rounded-[3px] border border-border bg-zinc-900/80 p-0.5">
                {ALL_AGENT_MODES.map((m) => {
                  const active = currentMode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => handleModeSelect(m)}
                      className={cn(
                        'px-2 py-0.5 font-mono text-[10.5px] font-medium rounded-[2px] transition-all capitalize',
                        active
                          ? m === 'plan'
                            ? 'border border-sky-500/50 bg-sky-950/60 text-sky-300 shadow-sm'
                            : m === 'ask'
                            ? 'border border-emerald-500/50 bg-emerald-950/60 text-emerald-300 shadow-sm'
                            : m === 'debug'
                            ? 'border border-amber-500/50 bg-amber-950/60 text-amber-300 shadow-sm'
                            : 'border border-zinc-600/60 bg-zinc-800 text-white shadow-sm'
                          : 'text-zinc-400 hover:text-zinc-200',
                      )}
                      title={`${m.toUpperCase()} mode (Cmd+I to focus)`}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
              {!busy && !needsWorkingDir && messages.length > 0 ? (
                <QuickChipsToggle onFill={fillInput} onSend={(t) => void sendText(t)} />
              ) : null}
              {busy ? (
                <>
                  <button type="button" onClick={stop} className="btn-danger shrink-0" title="Stop agent (Esc)">
                    <Square size={11} /> Stop
                  </button>
                  {midRunOn ? (
                    <button
                      type="submit"
                      disabled={!input.trim()}
                      className="btn-primary shrink-0"
                      title="Queue mid-run note"
                    >
                      <Send size={11} /> Send
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-ghost h-8 px-2 text-[11px]"
                    disabled={needsWorkingDir || !input.trim()}
                    title="Queue this prompt as a background job"
                    onClick={() => {
                      const p = input.trim();
                      if (!p) return;
                      enqueueChatAsJob({ prompt: p, threadId: thread.id, title: p.slice(0, 72) });
                      setInput('');
                    }}
                  >
                    <Play size={11} /> Job
                  </button>
                  <button type="submit" disabled={needsWorkingDir || !input.trim()} className="btn-icon shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40" aria-label="Send">
                    <Send size={16} />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
});
