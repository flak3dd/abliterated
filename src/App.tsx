import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CommandPalette, type CommandAction } from './components/CommandPalette';
import { BottomNav, DesktopRail } from './components/layout/Navigation';
import { StatusBar } from './components/layout/StatusBar';
import { resumeJobQueue } from './lib/jobRunner';
import { syncMcpServers } from './lib/mcpClient';
import { bridge, type BridgeStatus } from './lib/bridgeClient';
import { applyInferenceProvider, INFERENCE_PROVIDERS, resolveActiveSettings } from './lib/activeEndpoint';
import { cn } from './lib/cn';
import {
  DEFAULT_SETTINGS,
  generatePairingCode,
  getJobs,
  getSettings,
  getThreads,
  getWorkspace,
  isPlaceholderRoot,
  setSettings,
  setWorkspace,
  uid,
  upsertThread,
} from './lib/storage';
import { getLicenseState } from './lib/license';
import { workspaceGate } from './lib/workspaceGuard';
import { ApiScreen } from './screens/ApiScreen';
import { ChatScreen, type ChatScreenHandle } from './screens/ChatScreen';
import { HomeScreen } from './screens/HomeScreen';
import { JobsScreen } from './screens/JobsScreen';
import { ModelsScreen } from './screens/ModelsScreen';
import { ImagesScreen } from './screens/ImagesScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { WorkspaceScreen } from './screens/WorkspaceScreen';
import { DEFAULT_ENABLED_TOOLS, type ClientSettings, type InferenceProvider, type Job, type Tab, type Thread, type WorkspaceContext } from './types';

const TAB_BY_DIGIT: Record<string, Tab> = {
  '1': 'home',
  '2': 'workspace',
  '3': 'models',
  '4': 'jobs',
  '5': 'api',
  '6': 'images',
  '7': 'settings',
};

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

function modHint(mac: string, other: string): string {
  // Shown in palette; actual binding uses metaKey || ctrlKey
  if (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)) return mac;
  return other;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [visitedTabs, setVisitedTabs] = useState<Set<Tab>>(() => new Set<Tab>(['home']));
  useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }, [tab]);
  const [settings, setSettingsState] = useState<ClientSettings>(() => getSettings());
  const [threads, setThreads] = useState<Thread[]>(() => getThreads());
  const [jobs, setJobs] = useState<Job[]>(() => getJobs());
  const [workspace, setWorkspaceState] = useState<WorkspaceContext>(() => getWorkspace());
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>(bridge.currentStatus);
  const [agentLabel, setAgentLabel] = useState('');
  const [composerSeed, setComposerSeed] = useState<string | null>(null);
  const license = getLicenseState(settings);
  const planMode = settings.planModeEnabled === true;
  const buildMode = settings.buildModeEnabled !== false && !planMode;

  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const chatRef = useRef<ChatScreenHandle | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const desktop = window.ablitDesktop;
    if (!desktop?.getLicense) return;
    void desktop.getLicense().then((stored) => {
      const desk = (stored || '').trim();
      const cur = settingsRef.current;
      const local = (cur.licenseKey || '').trim();
      if (desk && desk !== local) {
        const localFree = getLicenseState({ licenseKey: local }).isFree;
        const deskState = getLicenseState({ licenseKey: desk });
        if (!local || (localFree && !deskState.isFree)) {
          const next = { ...cur, licenseKey: desk };
          setSettings(next);
          setSettingsState(next);
          return;
        }
      }
      if (local && !desk) {
        try {
          void desktop.setLicense?.(local);
        } catch {
          /* ignore */
        }
      }
    });
  }, []);

  useEffect(() => {
    let handshake = 0;
    const clearForbiddenWorkspace = (appRoot = bridge.currentAppRoot) => {
      const prev = workspaceRef.current;
      const gate = workspaceGate(prev.rootPath, appRoot);
      if (gate.ok || isPlaceholderRoot(prev.rootPath)) return;
      const next = { ...prev, rootPath: '' };
      setWorkspace(next);
      setWorkspaceState(next);
    };

    const applyDaemonRoot = (root: string) => {
      if (!root) return;
      if (!workspaceGate(root, bridge.currentAppRoot).ok) return;
      const prev = workspaceRef.current;
      if (!isPlaceholderRoot(prev.rootPath)) return;
      const next = { ...prev, rootPath: root };
      setWorkspace(next);
      setWorkspaceState(next);
    };

    const unsubRoot = bridge.onRootChange(applyDaemonRoot);
    const unsubAppRoot = bridge.onAppRootChange((appRoot) => {
      clearForbiddenWorkspace(appRoot);
    });
    const unsubStatus = bridge.onStatusChange((status) => {
      setBridgeStatus(status);
      if (status !== 'connected') return;
      const id = ++handshake;
      void (async () => {
        const path = workspaceRef.current.rootPath.trim();
        try {
          if (!isPlaceholderRoot(path)) {
            if (!workspaceGate(path, bridge.currentAppRoot).ok) {
              clearForbiddenWorkspace();
            } else {
              try {
                const root = await bridge.setRoot(path);
                if (id !== handshake) return;
                const prev = workspaceRef.current;
                if (prev.rootPath !== root) {
                  const next = { ...prev, rootPath: root };
                  setWorkspace(next);
                  setWorkspaceState(next);
                }
              } catch {
                if (id !== handshake) return;
                clearForbiddenWorkspace();
              }
            }
          }
          const hello = await bridge.hello();
          if (id !== handshake) return;
          if (hello.workspaceOk) applyDaemonRoot(hello.root);
          clearForbiddenWorkspace(hello.appRoot || bridge.currentAppRoot);
        } catch {
          /* daemon may not be listening yet; reconnect retries */
        }
      })();
    });

    bridge.connect();
    return () => {
      handshake += 1;
      unsubRoot();
      unsubAppRoot();
      unsubStatus();
      bridge.cleanup();
    };
  }, []);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? null,
    [threads, activeThreadId],
  );

  const applySettings = useCallback((next: ClientSettings) => {
    setSettings(next);
    setSettingsState(next);
    // Rebind the open chat to the newly active provider model (Ablit ↔ Featherless ↔ Spark).
    const model = resolveActiveSettings(next).defaultModel;
    if (!model || !activeThreadId) return;
    setThreads((prev) => {
      const existing = prev.find((t) => t.id === activeThreadId);
      if (!existing || existing.model === model) return prev;
      return upsertThread({ ...existing, model, updatedAt: Date.now() });
    });
  }, [activeThreadId]);

  const patchSettings = useCallback((partial: Partial<ClientSettings>) => {
    applySettings({ ...settingsRef.current, ...partial });
  }, [applySettings]);

  const providerCueTimer = useRef<number | null>(null);
  const switchProvider = useCallback(
    (p: InferenceProvider) => {
      const next = applyInferenceProvider(settingsRef.current, p);
      applySettings(next);
      // Light UX cue when idle (skip while agent busy).
      if (!agentLabel) {
        const name = INFERENCE_PROVIDERS.find((x) => x.id === p)?.label ?? p;
        const cue = `Using ${name}…`;
        setAgentLabel(cue);
        if (providerCueTimer.current != null) window.clearTimeout(providerCueTimer.current);
        providerCueTimer.current = window.setTimeout(() => {
          setAgentLabel((cur) => (cur === cue ? '' : cur));
          providerCueTimer.current = null;
        }, 2000);
      }
    },
    [agentLabel, applySettings],
  );

  const createSession = useCallback(() => {
    const s = settingsRef.current;
    const active = resolveActiveSettings(s);
    const now = Date.now();
    const thread: Thread = {
      id: uid('thr'),
      title: 'New session',
      model: active.defaultModel,
      pinned: false,
      systemPrompt: s.systemPrompt,
      enabledTools: [...DEFAULT_ENABLED_TOOLS],
      createdAt: now,
      updatedAt: now,
    };
    setThreads(upsertThread(thread));
    setActiveThreadId(thread.id);
  }, []);

  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;

  const chooseWorkspace = useCallback(async (path: string) => {
    const trimmed = path.trim();
    const gate = workspaceGate(trimmed, bridge.currentAppRoot);
    if (!gate.ok) throw new Error(gate.message);
    let root = trimmed;
    if (bridge.connected) {
      root = await bridge.setRoot(trimmed);
    }
    const prev = workspaceRef.current;
    const next = { ...prev, rootPath: root };
    setWorkspace(next);
    setWorkspaceState(next);
    const id = activeThreadIdRef.current;
    if (id) {
      setThreads((prevThreads) => {
        const existing = prevThreads.find((t) => t.id === id);
        if (!existing) return prevThreads;
        if ((existing.workspaceRoot || undefined) === root) return prevThreads;
        return upsertThread({ ...existing, workspaceRoot: root, updatedAt: Date.now() });
      });
    }
  }, []);

  /** Keep an already-stamped session in sync when the root changes. New chats stay empty until the picker confirms. */
  useEffect(() => {
    const id = activeThreadIdRef.current;
    if (!id) return;
    const root = workspace.rootPath.trim() || undefined;
    setThreads((prev) => {
      const existing = prev.find((t) => t.id === id);
      if (!existing?.workspaceRoot) return prev;
      if ((existing.workspaceRoot || undefined) === root) return prev;
      return upsertThread({ ...existing, workspaceRoot: root, updatedAt: Date.now() });
    });
  }, [workspace.rootPath]);

  /** Open a past thread, rebind model, backfill/restore workspace root. */
  const openThread = useCallback((id: string) => {
    const s = settingsRef.current;
    const active = resolveActiveSettings(s);
    const list = getThreads();
    const existing = list.find((t) => t.id === id);
    if (!existing) {
      setActiveThreadId(id);
      return;
    }
    const model = active.defaultModel || existing.model;
    const currentRoot = workspaceRef.current.rootPath.trim();
    let next: Thread = existing;
    let changed = false;
    if (existing.model !== model) {
      next = { ...next, model };
      changed = true;
    }
    if (
      !existing.workspaceRoot &&
      currentRoot &&
      workspaceGate(currentRoot, bridge.currentAppRoot).ok
    ) {
      next = { ...next, workspaceRoot: currentRoot };
      changed = true;
    }
    if (changed) {
      next = { ...next, updatedAt: Date.now() };
      setThreads(upsertThread(next));
    }
    setActiveThreadId(id);

    const threadRoot = (next.workspaceRoot || '').trim();
    if (
      threadRoot &&
      !isPlaceholderRoot(threadRoot) &&
      threadRoot !== currentRoot &&
      workspaceGate(threadRoot, bridge.currentAppRoot).ok
    ) {
      const prev = workspaceRef.current;
      const wsNext = { ...prev, rootPath: threadRoot };
      setWorkspace(wsNext);
      setWorkspaceState(wsNext);
      if (bridge.connected) {
        void (async () => {
          try {
            const root = await bridge.setRoot(threadRoot);
            const p = workspaceRef.current;
            if (root && root !== p.rootPath) {
              const normalized = { ...p, rootPath: root };
              setWorkspace(normalized);
              setWorkspaceState(normalized);
            }
          } catch {
            /* keep stamped path in history; local workspace already updated */
          }
        })();
      }
    }
  }, []);

  const refreshGitStatus = useCallback(async () => {
    if (!bridge.connected) return;
    try {
      const gs = await bridge.gitStatus();
      const prev = workspaceRef.current;
      const branch = gs.branch || '';
      if (prev.currentBranch !== branch || prev.isDirty !== gs.dirty) {
        const next = { ...prev, currentBranch: branch, isDirty: gs.dirty };
        setWorkspace(next);
        setWorkspaceState(next);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const copyPairingCode = useCallback(async () => {
    const code = settingsRef.current.pairingCode;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      /* ignore */
    }
  }, []);

  const handleWiped = () => {
    setSettingsState({ ...DEFAULT_SETTINGS, pairingCode: generatePairingCode() });
    setThreads([]);
    setJobs([]);
    setWorkspaceState(getWorkspace());
    setActiveThreadId(null);
    setTab('home');
    setAgentLabel('');
  };

  const paletteActions = useMemo((): CommandAction[] => {
    const k = (mac: string, win: string) => modHint(mac, win);
    const actions: CommandAction[] = [
      {
        id: 'new-session',
        label: 'New session',
        hint: k('⌘N', 'Ctrl+N'),
        keywords: 'create chat thread',
        run: createSession,
      },
      {
        id: 'tab-home',
        label: 'Go to Home',
        hint: k('⌘1', 'Ctrl+1'),
        run: () => setTab('home'),
      },
      {
        id: 'tab-workspace',
        label: 'Go to Workspace',
        hint: k('⌘2', 'Ctrl+2'),
        run: () => setTab('workspace'),
      },
      {
        id: 'tab-models',
        label: 'Go to Models',
        hint: k('⌘3', 'Ctrl+3'),
        run: () => setTab('models'),
      },
      {
        id: 'tab-jobs',
        label: 'Go to Jobs',
        hint: k('⌘4', 'Ctrl+4'),
        run: () => setTab('jobs'),
      },
      {
        id: 'tab-api',
        label: 'Go to API',
        hint: k('⌘5', 'Ctrl+5'),
        run: () => setTab('api'),
      },
      {
        id: 'tab-images',
        label: 'Go to Images',
        hint: k('⌘6', 'Ctrl+6'),
        run: () => setTab('images'),
      },
      {
        id: 'tab-settings',
        label: 'Go to Settings',
        hint: k('⌘7', 'Ctrl+7'),
        run: () => setTab('settings'),
      },
      {
        id: 'toggle-auto-accept',
        label: settings.autoAcceptEdits ? 'Disable auto-accept file edits' : 'Enable auto-accept file edits',
        keywords: 'toggle edits',
        run: () => patchSettings({ autoAcceptEdits: !settingsRef.current.autoAcceptEdits }),
      },
      {
        id: 'toggle-auto-run',
        label: settings.autoRunShell ? 'Disable auto-run shell' : 'Enable auto-run shell',
        keywords: 'toggle shell',
        run: () => patchSettings({ autoRunShell: !settingsRef.current.autoRunShell }),
      },
      {
        id: 'toggle-build-mode',
        label: settings.buildModeEnabled !== false ? 'Disable build mode' : 'Enable build mode',
        keywords: 'todo scaffold skeleton implement',
        run: () => {
          const on = settingsRef.current.buildModeEnabled === false;
          patchSettings({ buildModeEnabled: on, planModeEnabled: on ? false : settingsRef.current.planModeEnabled });
        },
      },
      {
        id: 'toggle-plan-mode',
        label: settings.planModeEnabled ? 'Disable plan mode' : 'Enable plan mode',
        keywords: 'checklist readonly',
        run: () => {
          const cur = settingsRef.current;
          const on = !cur.planModeEnabled;
          patchSettings({ planModeEnabled: on, buildModeEnabled: on ? false : true });
        },
      },
      {
        id: 'focus-workspace',
        label: 'Focus workspace / Connect hint',
        keywords: 'connect bridge folder',
        run: () => setTab('workspace'),
      },
      {
        id: 'semantic-search',
        label: 'Semantic search workspace',
        keywords: 'grep find search',
        run: () => {
          if (!activeThreadId) createSession();
          setComposerSeed('semantic_search ');
        },
      },
      {
        id: 'generate-image',
        label: 'Generate image…',
        keywords: 'flux png picture',
        run: () => setTab('images'),
      },
      {
        id: 'enable-image-gen',
        label: 'Enable image generator',
        keywords: 'flux spark-image',
        run: () => {
          patchSettings({ imageGenEnabled: true });
          setTab('images');
        },
      },
      {
        id: 'copy-pairing',
        label: 'Copy pairing code',
        keywords: 'pair remote',
        run: () => void copyPairingCode(),
      },
    ];

    if (activeThread) {
      actions.push(
        {
          id: 'stop-agent',
          label: 'Stop agent',
          keywords: 'abort cancel',
          run: () => chatRef.current?.stop(),
        },
        {
          id: 'retry-last',
          label: 'Retry last',
          keywords: 'redo',
          run: () => void chatRef.current?.retry(),
        },
        {
          id: 'back-sessions',
          label: 'Back to sessions',
          hint: 'Esc',
          run: () => {
            setActiveThreadId(null);
            setAgentLabel('');
          },
        },
      );
    }

    actions.push(
      {
        id: 'use-abliteration',
        label: 'Use Abliteration',
        keywords: 'provider cloud',
        run: () => switchProvider('abliteration'),
      },
      {
        id: 'use-dgx-spark',
        label: 'Use DGX Spark',
        keywords: 'provider nim spark',
        run: () => switchProvider('dgx-spark'),
      },
      {
        id: 'use-featherless',
        label: 'Use Featherless',
        keywords: 'provider featherless',
        run: () => switchProvider('featherless'),
      },
      {
        id: 'use-custom',
        label: 'Use Custom provider',
        keywords: 'provider custom',
        run: () => switchProvider('custom'),
      },
      {
        id: 'use-qwen-spark',
        label: 'Use Qwen on Spark',
        keywords: 'provider qwen abliterated spark nim',
        run: () =>
          applySettings({
            ...applyInferenceProvider(settingsRef.current, 'dgx-spark'),
            sparkModel: 'qwen-abliterated',
          }),
      },
      {
        id: 'toggle-spark-available',
        label: settings.sparkEnabled ? 'Mark Spark unavailable' : 'Toggle Spark available',
        keywords: 'spark enable disable',
        run: () => patchSettings({ sparkEnabled: !settingsRef.current.sparkEnabled }),
      },
    );

    if (bridgeStatus === 'connected') {
      actions.push({
        id: 'refresh-git',
        label: 'Refresh git status',
        keywords: 'branch dirty',
        run: () => void refreshGitStatus(),
      });
    }

    return actions;
  }, [
    activeThread,
    bridgeStatus,
    copyPairingCode,
    createSession,
    patchSettings,
    refreshGitStatus,
    settings.autoAcceptEdits,
    settings.autoRunShell,
    settings.buildModeEnabled,
    settings.planModeEnabled,
    settings.sparkEnabled,
    switchProvider,
    applySettings,
  ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const typing = isTypingTarget(e.target);

      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }

      if (e.key === 'Escape') {
        if (paletteOpen) {
          e.preventDefault();
          setPaletteOpen(false);
          return;
        }
        if (activeThreadId) {
          // Prefer Stop while the agent is busy (ChatScreen also handles Esc).
          if (agentLabel) {
            e.preventDefault();
            chatRef.current?.stop();
            return;
          }
          e.preventDefault();
          setActiveThreadId(null);
          setAgentLabel('');
          return;
        }
        return;
      }

      if (typing) return;
      if (paletteOpen) return;

      if (mod && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        createSession();
        return;
      }

      if (mod && TAB_BY_DIGIT[e.key]) {
        e.preventDefault();
        setTab(TAB_BY_DIGIT[e.key]);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [activeThreadId, agentLabel, createSession, paletteOpen]);

  const jobsActive = useMemo(
    () => jobs.some((j) => j.status === 'queued' || j.status === 'running'),
    [jobs],
  );

  const panelClass = (id: Tab) =>
    cn('h-full', tab !== id && 'hidden pointer-events-none');


  useEffect(() => {
    resumeJobQueue();
  }, []);

  useEffect(() => {
    if (bridgeStatus === 'connected') {
      void syncMcpServers(settings.mcpServers || []);
    }
  }, [bridgeStatus, settings.mcpServers]);

  return (
    <div className="flex h-full bg-background text-zinc-100">
      <DesktopRail current={tab} onChange={setTab} jobsActive={jobsActive} />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="relative min-h-0 flex-1">
          <div className="h-full">
            {visitedTabs.has('home') ? (
              <div className={panelClass('home')}>
                <HomeScreen
                  threads={threads}
                  settings={settings}
                  onThreadsChange={setThreads}
                  onOpenThread={openThread}
                  onNewSession={createSession}
                  workspaceRoot={workspace.rootPath}
                />
              </div>
            ) : null}
            {visitedTabs.has('workspace') ? (
              <div className={panelClass('workspace')}>
                <WorkspaceScreen workspace={workspace} onChange={setWorkspaceState} />
              </div>
            ) : null}
            {visitedTabs.has('models') ? (
              <div className={panelClass('models')}>
                <ModelsScreen settings={settings} onSettingsChange={applySettings} />
              </div>
            ) : null}
            {visitedTabs.has('jobs') ? (
              <div className={panelClass('jobs')}>
                <JobsScreen jobs={jobs} onJobsChange={setJobs} />
              </div>
            ) : null}
            {visitedTabs.has('api') ? (
              <div className={panelClass('api')}>
                <ApiScreen settings={settings} onSettingsChange={applySettings} />
              </div>
            ) : null}
            {visitedTabs.has('images') ? (
              <div className={panelClass('images')}>
                <ImagesScreen settings={settings} onSettingsChange={applySettings} />
              </div>
            ) : null}
            {visitedTabs.has('settings') ? (
              <div className={panelClass('settings')}>
                <SettingsScreen
                  settings={settings}
                  onSettingsChange={applySettings}
                  onWiped={handleWiped}
                />
              </div>
            ) : null}
          </div>
          {activeThread ? (
            <div className="absolute inset-0 z-10">
              <ChatScreen
                ref={chatRef}
                thread={activeThread}
                settings={settings}
                autoAcceptEdits={settings.autoAcceptEdits}
                autoRunShell={settings.autoRunShell}
                workspaceRoot={workspace.rootPath}
                onChooseWorkspace={chooseWorkspace}
                onBack={() => {
                  setActiveThreadId(null);
                  setAgentLabel('');
                }}
                onThreadUpdate={(t) => setThreads((prev) => prev.map((x) => (x.id === t.id ? t : x)))}
                onAgentStatus={setAgentLabel}
                onGitMaybeChanged={() => void refreshGitStatus()}
                composerSeed={composerSeed}
                onComposerSeedConsumed={() => setComposerSeed(null)}
                planMode={planMode}
                buildMode={buildMode}
                onTogglePlanMode={() => {
                  const cur = settingsRef.current;
                  const next = !cur.planModeEnabled;
                  applySettings({
                    ...cur,
                    planModeEnabled: next,
                    buildModeEnabled: next ? false : true,
                  });
                }}
                onToggleBuildMode={() => {
                  const cur = settingsRef.current;
                  const next = cur.buildModeEnabled === false;
                  applySettings({
                    ...cur,
                    buildModeEnabled: next,
                    planModeEnabled: next ? false : cur.planModeEnabled,
                  });
                }}
                onApprovePlan={() => {
                  applySettings({
                    ...settingsRef.current,
                    planModeEnabled: false,
                    buildModeEnabled: true,
                  });
                  setComposerSeed(
                    'Plan approved. Build mode is on. After reasoning emit ToDo: steps. If new file/folder structure is required, scaffold it first, then work the list. Write tools are unlocked.',
                  );
                }}
              />
            </div>
          ) : null}
        </main>
        <StatusBar
          bridgeStatus={bridgeStatus}
          workspaceRoot={workspace.rootPath}
          branch={workspace.currentBranch}
          isDirty={workspace.isDirty}
          autoAcceptEdits={settings.autoAcceptEdits}
          autoRunShell={settings.autoRunShell}
          agentLabel={agentLabel}
          providerLabel={resolveActiveSettings(settings).label}
          provider={settings.inferenceProvider ?? 'abliteration'}
          onProviderChange={switchProvider}
          showWatermark={license.features.showWatermark}
          licenseLabel={license.isFree ? undefined : license.label}
          onUpgradeClick={() => setTab('settings')}
        />
        <BottomNav current={tab} onChange={setTab} jobsActive={jobsActive} />
      </div>
      <CommandPalette open={paletteOpen} actions={paletteActions} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
