import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { ArrowLeft, ArrowDown, RotateCcw, Send, Square, PanelRight, Play, Zap, ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';
import { DEEPEN_COMPLETENESS_CHAT_LABEL, DEEPEN_COMPLETENESS_TOOLTIP } from '../lib/deepenComplete';
import { MessageBubble } from '../components/chat/MessageBubble';
import { AgentStatusMonitor } from '../components/chat/AgentStatusMonitor';
import { WorkingDirPrompt } from '../components/chat/WorkingDirPrompt';
import { resolveActiveSettings } from '../lib/activeEndpoint';
import { ProofChip } from '../components/chat/ProofChip';
import { enqueueChatAsJob } from '../lib/jobRunner';
import { ModelSettingsGuidePanel } from '../components/common/ModelSettingsGuide';
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

  const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl+K';
  const midRunOn = settings.midRunInjectEnabled !== false;
  const thoughtOn = settings.reasoning !== 'off';
  const placeholder = needsWorkingDir
    ? 'Choose a working directory first'
    : busy
    ? midRunOn
      ? 'Send to adjust mid-run…'
      : 'Agent busy — Stop to cancel'
    : planMode
      ? 'Plan mode — checklist only (no diffs) · Enter send'
      : buildMode
        ? 'Build mode — ToDo then diffs in content · Enter send'
        : thoughtOn
          ? 'Thought on — Goal/Inspect/Steps in reasoning · Enter send'
          : `Message · @src/foo.ts pin · ${modKey} commands · Enter send`;

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border bg-background/80 px-4 py-3.5 backdrop-blur">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[20px] font-semibold tracking-tight text-foreground">{thread.title}</div>
          <div className="truncate font-mono text-[10.5px] text-muted-foreground">
            {resolveActiveSettings(settings).label} · {statusLabel}
          </div>
        </div>
        <button type="button" onClick={() => void retry()} disabled={busy} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
          <RotateCcw size={14} />
        </button>
        {onToggleFilePanel ? (
          <button
            type="button"
            aria-label={filePanelOpen ? 'Hide workspace panel' : 'Show workspace panel'}
            aria-pressed={filePanelOpen}
            onClick={onToggleFilePanel}
            className={cn(
              'hidden rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:inline-flex',
              filePanelOpen && 'bg-accent text-foreground',
            )}
          >
            <PanelRight size={16} />
          </button>
        ) : null}
      </header>
      {onSettingsChange ? (
        <ModelSettingsGuidePanel
          compact
          model={resolveActiveSettings(settings).defaultModel}
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
                  completionFooterEnabled={settings.completionFooterEnabled !== false}
                  onContinuePrompt={handleContinuePrompt}
                  skipHighlight={m.status === 'streaming'}
                  onApprovePlan={() => {
                    const host = messagesRef.current.find((x) => x.planApproved === 'awaiting');
                    if (host) persist({ ...host, planApproved: 'approved' });
                    onApprovePlan?.();
                    if (!onApprovePlan) onTogglePlanMode?.();
                  }}
                  onDeclinePlan={() => onTogglePlanMode?.()}
                  onOpenFile={(path) => {
                    fillInput(`@${path} `);
                    if (!filePanelOpen) onToggleFilePanel?.();
                  }}
                />
              ))}
            </>
          )}
        </div>
        {showJump ? (
          <button
            type="button"
            onClick={() => scrollToBottom(true)}
            className="absolute bottom-3 left-1/2 z-[1] inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface/95 px-3 py-1 font-mono text-[10px] text-zinc-200 shadow-lg backdrop-blur hover:border-zinc-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500"
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
        className="border-t border-border bg-background px-3 py-2"
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
        {busy ? (
          <div className="mb-1 font-mono text-[10px] text-zinc-600">Esc stops</div>
        ) : null}
        <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-panel shadow-[0_18px_40px_-32px_rgba(0,0,0,0.9)] transition-colors focus-within:border-primary/50">
        <div className="flex flex-col">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={placeholder}
            disabled={needsWorkingDir}
            className="w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground field max-h-32 border-0 focus-visible:ring-0"
          />
        <div className="flex flex-wrap items-end gap-2 px-3 pb-2.5 pt-1">
          <label
            className={
              'flex shrink-0 cursor-pointer select-none items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] ' +
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
          <div className="flex items-center rounded-lg border border-border/80 bg-zinc-900/90 p-0.5 shadow-inner">
            {ALL_AGENT_MODES.map((m) => {
              const active = currentMode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleModeSelect(m)}
                  className={cn(
                    'px-2 py-0.5 font-mono text-[10.5px] font-medium rounded transition-all capitalize',
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
