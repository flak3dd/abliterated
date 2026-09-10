import { useEffect, useState } from 'react';
import { Section } from './SettingsShared';

interface SystemTabProps {
  confirming: boolean;
  wipe: () => void;
}

export function SystemTab({ confirming, wipe }: SystemTabProps) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    return window.ablitDesktop?.onUpdateStatus?.((p) => {
      if (p.state === 'available') setNote(`Update ${p.version} available`);
      else if (p.state === 'downloading') setNote(`Downloading ${Math.round(p.percent || 0)}%`);
      else if (p.state === 'ready') {
        setReady(true);
        setNote(`Ready to install ${p.version || ''}`);
      } else if (p.state === 'error') setNote(p.error || 'Update error');
      else if (p.state === 'none') setNote('You are on the current build');
    });
  }, []);

  return (
    <div className="space-y-4">
      {/* 1. Desktop Updates */}
      <Section
        title="Desktop Updates"
        hint="Checks GitHub Releases for 1.0.2-beta and newer builds."
      >
        {!window.ablitDesktop?.checkUpdate ? (
          <p className="font-mono text-[11px] text-muted">
            Running in Browser / DEV mode — auto-updates apply to packaged Electron app only.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-ghost h-8 px-3 text-[12px]"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void window.ablitDesktop?.checkUpdate?.().then((r) => {
                    setBusy(false);
                    if (r?.ok && r.version && r.version !== r.current) setNote(`Update ${r.version} available (currently on ${r.current})`);
                    else if (r?.ok) setNote(`Current build ${r.current || ''} is up to date`);
                    else setNote(r?.error || r?.reason || 'Check failed');
                  });
                }}
              >
                Check for Updates
              </button>
              <button
                type="button"
                className="btn-ghost h-8 px-3 text-[12px]"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void window.ablitDesktop?.downloadUpdate?.().then((r) => {
                    setBusy(false);
                    setNote(r?.ok ? 'Downloading update…' : r?.error || r?.reason || 'Download failed');
                  });
                }}
              >
                Download Update
              </button>
              <button
                type="button"
                className="btn-primary h-8 px-3 text-[12px]"
                disabled={!ready}
                onClick={() => void window.ablitDesktop?.quitAndInstall?.()}
              >
                Restart & Install
              </button>
            </div>
            {note ? <p className="font-mono text-[11px] text-zinc-300">{note}</p> : null}
          </div>
        )}
      </Section>

      {/* 2. Documentation */}
      <Section
        title="Documentation & Guides"
        hint="In-app interactive guide and technical reference."
      >
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="/docs/"
            target="_blank"
            rel="noreferrer"
            className="btn-primary inline-flex h-8 items-center px-4 font-mono text-[12px]"
          >
            Open In-App Docs (/docs/)
          </a>
          <span className="font-mono text-[11px] text-muted">
            Raw guide file: <code className="text-zinc-300">public/docs/APP.md</code>
          </span>
        </div>
      </Section>

      {/* 3. Danger Zone */}
      <Section
        title="Danger Zone"
        hint="Wipe settings, chat threads, messages, background jobs, and workspace link from localStorage."
        danger
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[12px] font-bold text-rose-300">
              Reset Application State
            </div>
            <p className="mt-0.5 font-mono text-[11px] text-zinc-400">
              Permanently clears local browser storage for Abliterated IDE. Cannot be undone.
            </p>
          </div>
          <button
            type="button"
            onClick={wipe}
            className="btn-danger h-8 px-4 font-mono text-[12px] font-bold"
          >
            {confirming ? '⚠️ Click again to confirm wipe' : 'Wipe All Data'}
          </button>
        </div>
      </Section>
    </div>
  );
}
