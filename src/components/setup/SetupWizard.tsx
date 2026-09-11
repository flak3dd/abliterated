import { useState } from 'react';
import { applyInferenceProvider, INFERENCE_PROVIDERS, resolveActiveSettings } from '../../lib/activeEndpoint';
import { streamChatCompletion } from '../../lib/sse';
import { getLicenseState, LICENSE_TEST_KEYS, normalizeLicenseKey } from '../../lib/license';
import type { ClientSettings, InferenceProvider } from '../../types';

type Props = {
  settings: ClientSettings;
  onSettingsChange: (s: ClientSettings) => void;
};

export function SetupWizard({ settings, onSettingsChange }: Props) {
  const [step, setStep] = useState(0);
  const [key, setKey] = useState(settings.licenseKey || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const patch = (partial: Partial<ClientSettings>) => {
    const next = { ...settings, ...partial };
    onSettingsChange(next);
  };

  const finish = (skip: boolean) => {
    patch({ setupComplete: true, licenseKey: skip ? settings.licenseKey : normalizeLicenseKey(key) || settings.licenseKey });
  };

  const testChat = async () => {
    setBusy(true);
    setNote('');
    try {
      let text = '';
      const active = resolveActiveSettings(settings);
      await streamChatCompletion({
        settings,
        model: active.defaultModel,
        messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
        enabledTools: [],
        onDelta: (t) => {
          text += t;
        },
      });
      setNote(text.trim() ? `Chat ok: ${text.trim().slice(0, 80)}` : 'Empty reply — check token/model.');
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-[4px] border border-border bg-background p-5 shadow-xl">
        <div className="font-mono text-[10px] uppercase text-muted">First-run setup · {step + 1}/3</div>
        <h2 className="mt-1 text-lg font-semibold text-foreground">Connect Abliterated</h2>

        {step === 0 ? (
          <div className="mt-4 space-y-3">
            <p className="text-[13px] text-muted-foreground">Paste a license key, or continue on Free.</p>
            <input
              className="field"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="ABLIT-PRO-XXXX-XXXX"
              autoComplete="off"
            />
            <p className="font-mono text-[10px] text-muted">
              Test stubs: {LICENSE_TEST_KEYS.pro} · {getLicenseState({ licenseKey: key }).label}
            </p>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="mt-4 space-y-3">
            <p className="text-[13px] text-muted-foreground">Pick the chat provider for this machine.</p>
            <div className="flex flex-wrap gap-2">
              {INFERENCE_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={
                    (settings.inferenceProvider || 'abliteration') === p.id ? 'btn-primary h-8 px-3 text-[12px]' : 'btn-ghost h-8 px-3 text-[12px]'
                  }
                  onClick={() => onSettingsChange(applyInferenceProvider(settings, p.id as InferenceProvider))}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {(settings.inferenceProvider || '') === 'featherless' ? (
              <input
                className="field"
                type="password"
                value={settings.featherlessToken}
                onChange={(e) => patch({ featherlessToken: e.target.value })}
                placeholder="Featherless API key"
                autoComplete="off"
              />
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mt-4 space-y-3">
            <p className="text-[13px] text-muted-foreground">Send a one-token test so you know chat works before the first real job.</p>
            <button type="button" className="btn-primary h-8 px-3 text-[12px]" disabled={busy} onClick={() => void testChat()}>
              {busy ? 'Testing…' : 'Test chat'}
            </button>
            {note ? <pre className="max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-zinc-300">{note}</pre> : null}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-between gap-2">
          <button type="button" className="btn-ghost h-8 px-3 text-[12px]" onClick={() => finish(true)}>
            Skip
          </button>
          <div className="flex gap-2">
            {step > 0 ? (
              <button type="button" className="btn-ghost h-8 px-3 text-[12px]" onClick={() => setStep((s) => s - 1)}>
                Back
              </button>
            ) : null}
            {step < 2 ? (
              <button
                type="button"
                className="btn-primary h-8 px-3 text-[12px]"
                onClick={() => {
                  if (step === 0 && key.trim()) patch({ licenseKey: normalizeLicenseKey(key) });
                  setStep((s) => s + 1);
                }}
              >
                Next
              </button>
            ) : (
              <button type="button" className="btn-primary h-8 px-3 text-[12px]" onClick={() => finish(false)}>
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
