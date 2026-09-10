import { Section, FieldLabel } from './SettingsShared';
import type { ClientSettings } from '../../types';

export interface AccountTabProps {
  settings: ClientSettings;
  authMode: 'signup' | 'login';
  setAuthMode: React.Dispatch<React.SetStateAction<'signup' | 'login'>>;
  authEmail: string;
  setAuthEmail: React.Dispatch<React.SetStateAction<string>>;
  authPassword: string;
  setAuthPassword: React.Dispatch<React.SetStateAction<string>>;
  authLoginId: string;
  setAuthLoginId: React.Dispatch<React.SetStateAction<string>>;
  authAdvanced: boolean;
  setAuthAdvanced: React.Dispatch<React.SetStateAction<boolean>>;
  authBusy: boolean;
  authMsg: string;
  deviceIdDisplay: string;
  handleLogout: () => void;
  handleSignup: () => Promise<void>;
  handleLoginEmail: () => Promise<void>;
  handleLoginWithLoginId: () => Promise<void>;
}

export function AccountTab({
  settings,
  authMode,
  setAuthMode,
  authEmail,
  setAuthEmail,
  authPassword,
  setAuthPassword,
  authLoginId,
  setAuthLoginId,
  authAdvanced,
  setAuthAdvanced,
  authBusy,
  authMsg,
  deviceIdDisplay,
  handleLogout,
  handleSignup,
  handleLoginEmail,
  handleLoginWithLoginId,
}: AccountTabProps) {
  return (
    <div className="space-y-4">
      {/* 1. Account Profile Card */}
      <div className="rounded-xl border border-zinc-800 bg-gradient-to-r from-zinc-950 via-zinc-900/60 to-zinc-950 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-lg">
              👤
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted">Account Status</div>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-white">
                  {settings.accountLoggedIn ? (settings.accountEmail || 'Signed In') : 'Guest Session (Local-Only)'}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[9.5px] font-semibold uppercase ${
                    settings.accountLoggedIn
                      ? 'border border-emerald-500/50 bg-emerald-950/60 text-emerald-300'
                      : 'border border-zinc-700 bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {settings.accountLoggedIn ? 'Online' : 'Local'}
                </span>
              </div>
            </div>
          </div>

          {settings.accountLoggedIn ? (
            <button
              type="button"
              className="btn-ghost h-7 px-3 text-[11px] text-zinc-300 hover:text-rose-300"
              disabled={authBusy}
              onClick={handleLogout}
            >
              Sign Out
            </button>
          ) : null}
        </div>

        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-zinc-800/80 pt-3 font-mono text-[11px] text-zinc-400">
          <div>
            loginId: <code className="text-zinc-200">{settings.loginId || '—'}</code>
          </div>
          <div className="truncate">
            deviceId: <code className="text-zinc-300">{deviceIdDisplay || settings.deviceId || '—'}</code>
          </div>
        </div>
      </div>

      {/* 2. Authentication / Login & Registration */}
      <Section
        title={settings.accountLoggedIn ? 'Signed In Credentials' : 'Sign Up or Log In'}
        hint="Sync your licenses and model allocations across devices with abliterated.app."
      >
        {settings.accountLoggedIn ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 font-mono text-[12px] text-zinc-200">
              <div className="text-[10px] uppercase text-muted">Current Account Profile</div>
              <div className="mt-1 font-semibold text-white">{settings.accountEmail || '(no email)'}</div>
              <div className="mt-1 text-[11px] text-muted">
                Device binding active. Your deviceId is registered to your account identity.
              </div>
            </div>
            <button
              type="button"
              className="btn-ghost h-7 px-3 text-[11px]"
              disabled={authBusy}
              onClick={handleLogout}
            >
              Log out
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`h-7 px-3 font-mono text-[11px] rounded ${
                  authMode === 'login' ? 'btn-primary' : 'btn-ghost'
                }`}
                onClick={() => setAuthMode('login')}
              >
                Log in
              </button>
              <button
                type="button"
                className={`h-7 px-3 font-mono text-[11px] rounded ${
                  authMode === 'signup' ? 'btn-primary' : 'btn-ghost'
                }`}
                onClick={() => setAuthMode('signup')}
              >
                Sign up
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <FieldLabel label="Email" hint="Account & receipt email.">
                <input
                  type="email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="field font-mono text-[12px]"
                  autoComplete="email"
                />
              </FieldLabel>
              <FieldLabel
                label="Password"
                hint={authMode === 'signup' ? 'At least 8 characters.' : 'Your password.'}
              >
                <input
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="••••••••"
                  className="field font-mono text-[12px]"
                  autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                />
              </FieldLabel>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                className="btn-primary h-7 px-4 text-[11px]"
                disabled={authBusy}
                onClick={() => void (authMode === 'signup' ? handleSignup() : handleLoginEmail())}
              >
                {authBusy ? 'Working…' : authMode === 'signup' ? 'Create Account' : 'Log in'}
              </button>
              <button
                type="button"
                className="btn-ghost h-7 px-2 text-[10px]"
                onClick={() => setAuthAdvanced((v) => !v)}
              >
                {authAdvanced ? 'Hide advanced' : 'Advanced (loginId + deviceId)'}
              </button>
            </div>

            {authAdvanced ? (
              <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-2">
                <FieldLabel label="loginId" hint="From redeem / prior signup — restores license.">
                  <input
                    value={authLoginId}
                    onChange={(e) => setAuthLoginId(e.target.value)}
                    placeholder="login_…"
                    className="field font-mono text-[12px]"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </FieldLabel>
                <FieldLabel label="deviceId" hint="Stable on this install.">
                  <input
                    value={deviceIdDisplay}
                    readOnly
                    className="field font-mono text-[11px] text-muted"
                  />
                </FieldLabel>
                <button
                  type="button"
                  className="btn-primary h-7 px-3 text-[11px]"
                  disabled={authBusy}
                  onClick={() => void handleLoginWithLoginId()}
                >
                  {authBusy ? 'Working…' : 'Log in with loginId'}
                </button>
              </div>
            ) : null}
          </div>
        )}
        {authMsg ? <p className="font-mono text-[11px] text-sky-300">{authMsg}</p> : null}
      </Section>
    </div>
  );
}
