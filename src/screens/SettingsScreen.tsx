import { useEffect, useRef, useState, type ReactNode } from 'react';
import { bridge } from '../lib/bridgeClient';
import {
  EXAMPLE_FILESYSTEM_MCP,
  disconnectMcpServer,
  getMcpServerState,
  getMcpServerStatuses,
  syncMcpServers,
} from '../lib/mcpClient';
import {
  LICENSE_TEST_KEYS,
  PRICING_HINT,
  countEnabledMcp,
  getLicenseState,
  normalizeLicenseKey,
  type LicenseState,
} from '../lib/license';
import {
  BILLING_PLAN_LABELS,
  BILLING_PLANS,
  BillingApiError,
  FALLBACK_CREDIT_PACKS,
  confirmCryptoInvoice,
  confirmSolanaPayment,
  createCryptoInvoice,
  createSolanaPayment,
  createStripeCheckout,
  extractStripeSessionId,
  getCheckoutSession,
  getCryptoInvoice,
  getOrCreateDeviceId,
  getSolanaPayment,
  listCryptoCheckout,
  openBillingUrl,
  openCustomerPortal,
  redeemAccessCode,
  setupCard,
  type BillingPlan,
  type CreditPack,
  type CreditPackId,
} from '../lib/billingApi';
import {
  AuthApiError,
  ensureDeviceId,
  loginEmail,
  loginWithLoginId,
  signup,
} from '../lib/authApi';
import {
  formatTokenCount,
  loadBuiltinUsage,
  remainingBuiltinTokens,
} from '../lib/builtinTokens';
import { generatePairingCode, setSettings, uid, wipeAll } from '../lib/storage';
import { MEMPALACE_CATALOG_ENTRY, withMempalaceMcpServer } from '../lib/mempalace';
import { skillRootHints, toCatalogEntries, type SkillCatalogEntry } from '../lib/skills';
import type { ClientSettings, McpServerConfig } from '../types';

interface Props {
  settings: ClientSettings;
  onSettingsChange: (s: ClientSettings) => void;
  onWiped: () => void;
}

function BuiltinTokenMeter({ license }: { license: LicenseState }) {
  const usage = loadBuiltinUsage();
  const cap = license.features.maxIncludedTokens;
  const used = usage.used;
  const left = remainingBuiltinTokens(license, usage);
  const pct = !Number.isFinite(cap) || cap <= 0 ? 0 : Math.min(100, Math.round((used / cap) * 100));

  return (
    <div className="mt-2 rounded border border-border bg-background px-3 py-2">
      <div className="font-mono text-[10px] uppercase text-muted">Built-in model tokens this month</div>
      <div className="mt-1 font-mono text-[12px] text-zinc-200">
        {formatTokenCount(used)} used · {formatTokenCount(left)} left of {formatTokenCount(cap)}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded bg-zinc-800">
        <div
          className={`h-full ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-sky-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 font-mono text-[10px] text-muted">
        Abliteration built-in unrestricted model only. Featherless.ai catalog models do not count.
      </p>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
  danger,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <section className={`section-card${danger ? ' border-red-950 bg-red-950/20' : ''}`}>
      <div>
        <div className={`section-card-title${danger ? ' text-red-300' : ''}`}>{title}</div>
        {hint ? <p className="section-card-hint">{hint}</p> : null}
      </div>
      <div className="section-card-body">{children}</div>
    </section>
  );
}

function SwitchRow({
  label,
  help,
  checked,
  onChange,
  danger,
}: {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  danger?: boolean;
}) {
  return (
    <div className={`switch-row${danger ? ' switch-row--danger' : ''}`}>
      <label className="switch-row-main">
        <span>{label}</span>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      </label>
      {help ? <p className="switch-row-help">{help}</p> : null}
    </div>
  );
}

function FieldLabel({
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
      {label}
      <div className="mt-1">{children}</div>
      {hint ? <p className="mt-1 font-mono text-[11px] normal-case tracking-normal text-muted">{hint}</p> : null}
    </label>
  );
}

function commandPreview(s: McpServerConfig): string {
  const args = (s.args || []).join(' ');
  const full = `${s.command || ''}${args ? ` ${args}` : ''}`.trim();
  return full || '(no command)';
}

export function SettingsScreen({ settings, onSettingsChange, onWiped }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [mcpTick, setMcpTick] = useState(0);
  const [mcpBusyId, setMcpBusyId] = useState<string | null>(null);
  const [mcpHint, setMcpHint] = useState('');
  const [licenseDraft, setLicenseDraft] = useState(settings.licenseKey || '');
  const [licenseMsg, setLicenseMsg] = useState('');
  const preferredEmail = (settings.accountEmail || settings.billingEmail || '').trim();
  const [billingEmail, setBillingEmail] = useState(preferredEmail);
  const [authMode, setAuthMode] = useState<'signup' | 'login'>('login');
  const [authEmail, setAuthEmail] = useState(settings.accountEmail || '');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoginId, setAuthLoginId] = useState(settings.loginId || '');
  const [authAdvanced, setAuthAdvanced] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMsg, setAuthMsg] = useState('');
  const [deviceIdDisplay, setDeviceIdDisplay] = useState(settings.deviceId || '');
  const [billingPlan, setBillingPlan] = useState<BillingPlan>('pro_monthly');
  const [billingSeats, setBillingSeats] = useState(1);
  const [redeemCode, setRedeemCode] = useState('');
  const [planBusy, setPlanBusy] = useState<'stripe' | 'solana' | null>(null);
  const [planMsg, setPlanMsg] = useState('');
  const [cardsBusy, setCardsBusy] = useState<'setup' | 'portal' | null>(null);
  const [cardsMsg, setCardsMsg] = useState('');
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [pendingStripeSession, setPendingStripeSession] = useState<string | null>(null);
  const [pendingSolanaId, setPendingSolanaId] = useState<string | null>(null);
  const [solanaPayUrl, setSolanaPayUrl] = useState('');
  const [solanaAmount, setSolanaAmount] = useState('');
  const pollAbortRef = useRef(0);
  const cryptoPollAbortRef = useRef(0);
  const [cryptoBusy, setCryptoBusy] = useState<'load' | 'create' | 'poll' | null>(null);
  const [cryptoMsg, setCryptoMsg] = useState('');
  const [creditPacks, setCreditPacks] = useState<CreditPack[]>([...FALLBACK_CREDIT_PACKS]);
  const [creditPackId, setCreditPackId] = useState<CreditPackId>('credits_20m');
  const [cryptoAsset, setCryptoAsset] = useState('usdc_sol');
  const [pendingCryptoId, setPendingCryptoId] = useState<string | null>(null);
  const [cryptoPayUrl, setCryptoPayUrl] = useState('');
  const [cryptoPayUri, setCryptoPayUri] = useState('');
  const [cryptoAmountLabel, setCryptoAmountLabel] = useState('');
  const [skillRows, setSkillRows] = useState<SkillCatalogEntry[]>([]);
  const [skillsBusy, setSkillsBusy] = useState(false);
  const [mpHint, setMpHint] = useState('');
  const [mpBusy, setMpBusy] = useState<'which' | 'install' | 'init' | 'status' | null>(null);

  useEffect(() => {
    setLicenseDraft(settings.licenseKey || '');
  }, [settings.licenseKey]);

  useEffect(() => {
    const next = (settings.accountEmail || settings.billingEmail || '').trim();
    setBillingEmail(next);
  }, [settings.billingEmail, settings.accountEmail]);

  useEffect(() => {
    setAuthEmail(settings.accountEmail || '');
  }, [settings.accountEmail]);

  useEffect(() => {
    setAuthLoginId(settings.loginId || '');
  }, [settings.loginId]);

  useEffect(() => {
    setDeviceIdDisplay(settings.deviceId || '');
  }, [settings.deviceId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const id = await ensureDeviceId(settings, (deviceId) => {
          if (cancelled) return;
          if (deviceId !== (settings.deviceId || '')) {
            const next = { ...settings, deviceId };
            setSettings(next);
            onSettingsChange(next);
          }
        });
        if (!cancelled) setDeviceIdDisplay(id);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot ensure on mount / deviceId change
  }, [settings.deviceId]);

  useEffect(() => {
    return () => {
      pollAbortRef.current += 1;
      cryptoPollAbortRef.current += 1;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setCryptoBusy('load');
      try {
        const meta = await listCryptoCheckout(settings);
        if (!alive) return;
        const packs = meta.packs.length ? meta.packs : [...FALLBACK_CREDIT_PACKS];
        setCreditPacks(packs);
        setCreditPackId((prev) => (packs.some((p) => p.id === prev) ? prev : packs[0]?.id || 'credits_20m'));
        setCryptoMsg(
          meta.facilitator
            ? `Loaded ${packs.length} packs (${meta.facilitator}). Prepaid crypto — no auto-renew.`
            : `Loaded ${packs.length} packs. Prepaid crypto — no auto-renew.`,
        );
      } catch (err) {
        if (!alive) return;
        setCreditPacks([...FALLBACK_CREDIT_PACKS]);
        const msg =
          err instanceof BillingApiError ? err.message : err instanceof Error ? err.message : String(err);
        setCryptoMsg(`Using static packs (catalog unavailable: ${msg}). Prepaid — no auto-renew.`);
      } finally {
        if (alive) setCryptoBusy((b) => (b === 'load' ? null : b));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- catalog on site base change
  }, [settings.billingSiteUrl]);

  const patch = (partial: Partial<ClientSettings>) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    onSettingsChange(next);
  };

  const persistLicense = (rawKey: string) => {
    const key = normalizeLicenseKey(rawKey);
    setLicenseDraft(key);
    const nextLicense = getLicenseState({ licenseKey: key });
    patch({
      licenseKey: key,
      maxConcurrentJobs: nextLicense.tier === 'admin' ? 16 : nextLicense.tier === 'free' ? 1 : 4,
      selfDeepenPasses: nextLicense.features.maxSelfDeepenPasses,
    });
    try {
      void window.ablitDesktop?.setLicense?.(key);
    } catch {
      /* browser / no preload */
    }
    return nextLicense;
  };

  const rememberEmail = (email: string) => {
    const trimmed = email.trim();
    setBillingEmail(trimmed);
    const patchBody: Partial<ClientSettings> = {};
    if (trimmed !== (settings.billingEmail || '')) {
      patchBody.billingEmail = trimmed;
    }
    // Keep account email in sync when logged in and user edits receipt email.
    if (settings.accountLoggedIn && trimmed && trimmed !== (settings.accountEmail || '')) {
      patchBody.accountEmail = trimmed;
    }
    if (Object.keys(patchBody).length) patch(patchBody);
  };

  const effectiveBillingEmail = () => {
    const typed = billingEmail.trim();
    if (typed) return typed;
    return (settings.accountEmail || settings.billingEmail || '').trim();
  };

  const applyAuthSuccess = async (result: {
    loginId: string;
    email?: string | null;
    deviceId?: string | null;
    licenseKey?: string | null;
  }) => {
    const email = (result.email || authEmail || '').trim();
    const deviceId = (result.deviceId || deviceIdDisplay || (await ensureDeviceId(settings))).trim();
    const accountPatch: Partial<ClientSettings> = {
      accountLoggedIn: true,
      loginId: result.loginId,
      deviceId,
      accountEmail: email || settings.accountEmail || '',
    };
    if (email) {
      accountPatch.billingEmail = email;
      setBillingEmail(email);
      setAuthEmail(email);
    }
    setAuthLoginId(result.loginId);
    setDeviceIdDisplay(deviceId);
    setAuthPassword('');

    const rawKey = result.licenseKey != null ? String(result.licenseKey).trim() : '';
    if (rawKey) {
      const key = normalizeLicenseKey(rawKey);
      setLicenseDraft(key);
      const nextLicense = getLicenseState({ licenseKey: key });
      patch({
        ...accountPatch,
        licenseKey: key,
        maxConcurrentJobs: nextLicense.tier === 'admin' ? 16 : nextLicense.tier === 'free' ? 1 : 4,
        selfDeepenPasses: nextLicense.features.maxSelfDeepenPasses,
      });
      try {
        void window.ablitDesktop?.setLicense?.(key);
      } catch {
        /* browser / no preload */
      }
      setAuthMsg(`Signed in as ${email || result.loginId} — activated ${nextLicense.label}.`);
    } else {
      patch(accountPatch);
      setAuthMsg(`Signed in as ${email || result.loginId}.`);
    }
  };

  const handleSignup = async () => {
    setAuthBusy(true);
    setAuthMsg('');
    try {
      const deviceId = await ensureDeviceId(settings, (id) => {
        if (id !== (settings.deviceId || '')) patch({ deviceId: id });
        setDeviceIdDisplay(id);
      });
      const result = await signup(settings, {
        email: authEmail.trim(),
        password: authPassword,
        deviceId,
      });
      await applyAuthSuccess(result);
    } catch (err) {
      const msg =
        err instanceof AuthApiError || err instanceof BillingApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      setAuthMsg(`Sign up error: ${msg}`);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLoginEmail = async () => {
    setAuthBusy(true);
    setAuthMsg('');
    try {
      const deviceId = await ensureDeviceId(settings, (id) => {
        if (id !== (settings.deviceId || '')) patch({ deviceId: id });
        setDeviceIdDisplay(id);
      });
      const result = await loginEmail(settings, {
        email: authEmail.trim(),
        password: authPassword,
        deviceId,
      });
      await applyAuthSuccess(result);
    } catch (err) {
      const msg =
        err instanceof AuthApiError || err instanceof BillingApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      setAuthMsg(`Log in error: ${msg}`);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLoginWithLoginId = async () => {
    setAuthBusy(true);
    setAuthMsg('');
    try {
      const deviceId = await ensureDeviceId(settings, (id) => {
        if (id !== (settings.deviceId || '')) patch({ deviceId: id });
        setDeviceIdDisplay(id);
      });
      const result = await loginWithLoginId(settings, {
        loginId: authLoginId.trim(),
        deviceId,
      });
      await applyAuthSuccess(result);
    } catch (err) {
      const msg =
        err instanceof AuthApiError || err instanceof BillingApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      setAuthMsg(`Log in error: ${msg}`);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = () => {
    patch({
      accountLoggedIn: false,
      accountEmail: '',
      loginId: '',
      // keep deviceId for future logins / redeem binding
    });
    setAuthPassword('');
    setAuthMsg('Logged out.');
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const pollStripeUntilLicense = async (sessionId: string, gen: number) => {
    setPlanMsg(`Waiting for Stripe payment (session ${sessionId.slice(0, 18)}…)…`);
    for (let i = 0; i < 90; i++) {
      if (pollAbortRef.current !== gen) return;
      try {
        const session = await getCheckoutSession(settings, sessionId);
        if (session.license?.key) {
          const next = persistLicense(session.license.key);
          setPendingStripeSession(null);
          setPlanBusy(null);
          setPlanMsg(`Stripe paid — activated ${next.label}.`);
          return;
        }
        setPlanMsg(
          `Stripe: ${session.payment_status || session.status || 'pending'} — waiting for license… (${i + 1})`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setPlanMsg(`Stripe poll: ${msg}`);
      }
      await sleep(2500);
    }
    setPlanBusy(null);
    setPlanMsg('Stripe checkout timed out waiting for license. Paste the key from email if needed.');
  };

  const pollSolanaUntilLicense = async (paymentId: string, gen: number, email: string) => {
    setPlanMsg(`Waiting for Solana USDC (payment ${paymentId.slice(0, 12)}…)…`);
    for (let i = 0; i < 120; i++) {
      if (pollAbortRef.current !== gen) return;
      try {
        let status = await getSolanaPayment(settings, paymentId);
        if (!status.licenseKey && (status.status === 'pending' || status.status === 'created')) {
          try {
            const confirmed = await confirmSolanaPayment(settings, { paymentId, email });
            if (confirmed.licenseKey) {
              status = { ...status, licenseKey: confirmed.licenseKey, status: confirmed.status };
            } else if (confirmed.status) {
              status = { ...status, status: confirmed.status };
            }
          } catch {
            /* confirm may 400 while pending — keep polling GET */
          }
        }
        if (status.licenseKey) {
          const next = persistLicense(status.licenseKey);
          setPendingSolanaId(null);
          setPlanBusy(null);
          setPlanMsg(`Solana paid — activated ${next.label}.`);
          return;
        }
        if (status.status === 'expired') {
          setPlanBusy(null);
          setPlanMsg('Solana payment expired. Start a new USDC checkout.');
          return;
        }
        setPlanMsg(`Solana: ${status.status || 'pending'} — waiting for license… (${i + 1})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setPlanMsg(`Solana poll: ${msg}`);
      }
      await sleep(3000);
    }
    setPlanBusy(null);
    setPlanMsg('Solana checkout timed out waiting for license. Paste the key if email arrived.');
  };

  const startStripeCheckout = async () => {
    const email = effectiveBillingEmail();
    if (!email || !email.includes('@')) {
      setPlanMsg('Enter a receipt email before paying with card.');
      return;
    }
    rememberEmail(email);
    const gen = ++pollAbortRef.current;
    setPlanBusy('stripe');
    setPlanMsg('Creating Stripe checkout…');
    try {
      const deviceId = getOrCreateDeviceId(settings.deviceId);
      const created = await createStripeCheckout(settings, {
        plan: billingPlan,
        seats: billingPlan === 'team_monthly' ? billingSeats : undefined,
        email,
        client_reference_id: deviceId,
      });
      const sessionId = extractStripeSessionId(created.url);
      if (sessionId) setPendingStripeSession(sessionId);
      await openBillingUrl(created.url);
      if (sessionId) {
        await pollStripeUntilLicense(sessionId, gen);
      } else {
        setPlanBusy(null);
        setPlanMsg(
          'Opened Stripe checkout. Could not parse session id — paste your license key after payment.',
        );
      }
    } catch (err) {
      setPlanBusy(null);
      const msg = err instanceof BillingApiError ? err.message : err instanceof Error ? err.message : String(err);
      setPlanMsg(`Stripe error: ${msg}`);
    }
  };

  const startSolanaCheckout = async () => {
    const email = effectiveBillingEmail();
    if (email) rememberEmail(email);
    const gen = ++pollAbortRef.current;
    setPlanBusy('solana');
    setPlanMsg('Creating Solana USDC payment…');
    try {
      const created = await createSolanaPayment(settings, {
        plan: billingPlan,
        seats: billingPlan === 'team_monthly' ? billingSeats : undefined,
        email: email || undefined,
      });
      setPendingSolanaId(created.paymentId);
      setSolanaPayUrl(created.url);
      setSolanaAmount(created.amountUsdc);
      await openBillingUrl(created.url);
      setPlanMsg(
        `Solana pay URL ready (${created.amountUsdc} USDC). Open wallet / copy link, then wait for confirm…`,
      );
      await pollSolanaUntilLicense(created.paymentId, gen, email);
    } catch (err) {
      setPlanBusy(null);
      const msg = err instanceof BillingApiError ? err.message : err instanceof Error ? err.message : String(err);
      setPlanMsg(`Solana error: ${msg}`);
    }
  };

  const startSaveCard = async () => {
    const email = effectiveBillingEmail();
    if (!email || !email.includes('@')) {
      setCardsMsg('Enter an email before saving a card.');
      return;
    }
    rememberEmail(email);
    setCardsBusy('setup');
    setCardsMsg('Opening Stripe card setup…');
    try {
      const created = await setupCard(settings, { email });
      await openBillingUrl(created.url);
      setCardsMsg('Opened Stripe setup — save a card for future automated payments.');
    } catch (err) {
      const msg = err instanceof BillingApiError ? err.message : err instanceof Error ? err.message : String(err);
      setCardsMsg(`Save card error: ${msg}`);
    } finally {
      setCardsBusy(null);
    }
  };

  const startCustomerPortal = async () => {
    const email = effectiveBillingEmail();
    if (!email || !email.includes('@')) {
      setCardsMsg('Enter an email before opening the billing portal.');
      return;
    }
    rememberEmail(email);
    setCardsBusy('portal');
    setCardsMsg('Opening Stripe customer portal…');
    try {
      const created = await openCustomerPortal(settings, { email });
      await openBillingUrl(created.url);
      setCardsMsg('Opened customer portal — manage subscription and saved cards.');
    } catch (err) {
      const msg = err instanceof BillingApiError ? err.message : err instanceof Error ? err.message : String(err);
      setCardsMsg(`Portal error: ${msg}`);
    } finally {
      setCardsBusy(null);
    }
  };

  const loadCryptoCatalog = async () => {
    setCryptoBusy('load');
    setCryptoMsg('Loading credit packs…');
    try {
      const meta = await listCryptoCheckout(settings);
      const packs = meta.packs.length ? meta.packs : [...FALLBACK_CREDIT_PACKS];
      setCreditPacks(packs);
      if (!packs.some((p) => p.id === creditPackId) && packs[0]) {
        setCreditPackId(packs[0].id);
      }
      const usdc = meta.assets.find((a) => a.id === 'usdc_sol');
      if (usdc) setCryptoAsset('usdc_sol');
      setCryptoMsg(
        meta.facilitator
          ? `Loaded ${packs.length} packs (${meta.facilitator}). Prepaid crypto — no auto-renew.`
          : `Loaded ${packs.length} packs. Prepaid crypto — no auto-renew.`,
      );
    } catch (err) {
      setCreditPacks([...FALLBACK_CREDIT_PACKS]);
      const msg = err instanceof BillingApiError ? err.message : err instanceof Error ? err.message : String(err);
      setCryptoMsg(`Using static packs (catalog unavailable: ${msg}). Prepaid — no auto-renew.`);
    } finally {
      setCryptoBusy((b) => (b === 'load' ? null : b));
    }
  };

  const pollCryptoUntilPaid = async (invoiceId: string, gen: number, email: string) => {
    setCryptoMsg(`Waiting for crypto payment (invoice ${invoiceId.slice(0, 12)}…)…`);
    for (let i = 0; i < 120; i++) {
      if (cryptoPollAbortRef.current !== gen) return;
      try {
        let inv = await getCryptoInvoice(settings, invoiceId);
        const paid =
          inv.status === 'confirmed' ||
          Boolean(inv.creditsLedgerId) ||
          Boolean(inv.licenseKey);
        if (!paid && (inv.status === 'pending' || inv.status === 'created' || !inv.status)) {
          try {
            const confirmed = await confirmCryptoInvoice(settings, { invoiceId, email: email || undefined });
            if (confirmed.status === 'confirmed' || confirmed.creditsLedgerId || confirmed.licenseKey) {
              inv = {
                ...inv,
                status: confirmed.status || inv.status,
                creditsLedgerId: confirmed.creditsLedgerId || inv.creditsLedgerId,
                creditsTokens: confirmed.creditsTokens ?? inv.creditsTokens,
                licenseKey: confirmed.licenseKey || inv.licenseKey,
              };
            } else if (confirmed.status) {
              inv = { ...inv, status: confirmed.status };
            }
          } catch {
            /* confirm may fail while pending */
          }
        }
        if (inv.licenseKey) {
          const next = persistLicense(inv.licenseKey);
          setPendingCryptoId(null);
          setCryptoBusy(null);
          setCryptoMsg(`Crypto paid — activated ${next.label}.`);
          return;
        }
        if (inv.status === 'confirmed' || inv.creditsLedgerId) {
          setPendingCryptoId(null);
          setCryptoBusy(null);
          const tokens = inv.creditsTokens ? ` (${inv.creditsTokens.toLocaleString()} tokens)` : '';
          setCryptoMsg(`Crypto paid — credits credited${tokens}. Prepaid pack — no auto-renew.`);
          return;
        }
        if (inv.status === 'expired') {
          setCryptoBusy(null);
          setCryptoMsg('Crypto invoice expired. Create a new invoice.');
          return;
        }
        setCryptoMsg(`Crypto: ${inv.status || 'pending'} — waiting for payment… (${i + 1})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setCryptoMsg(`Crypto poll: ${msg}`);
      }
      await sleep(3000);
    }
    setCryptoBusy(null);
    setCryptoMsg('Crypto checkout timed out. Credits appear after chain confirm — retry poll if needed.');
  };

  const startCryptoCheckout = async () => {
    const email = effectiveBillingEmail();
    if (!email || !email.includes('@')) {
      setCryptoMsg('Enter an email before buying credits with crypto.');
      return;
    }
    rememberEmail(email);
    const gen = ++cryptoPollAbortRef.current;
    setCryptoBusy('create');
    setCryptoMsg('Creating crypto invoice…');
    try {
      const created = await createCryptoInvoice(settings, {
        creditPackId,
        email,
        asset: cryptoAsset || 'usdc_sol',
      });
      setPendingCryptoId(created.invoiceId);
      setCryptoPayUrl(created.url);
      setCryptoPayUri(created.uri || '');
      const amt =
        created.amountCrypto && created.symbol
          ? `${created.amountCrypto} ${created.symbol}`
          : created.amountUsd != null
            ? `$${created.amountUsd}`
            : '';
      setCryptoAmountLabel(amt);
      await openBillingUrl(created.url);
      setCryptoMsg(
        created.note ||
          `Invoice ready${amt ? ` (${amt})` : ''}. Pay the exact amount — prepaid credits, no auto-renew.`,
      );
      setCryptoBusy('poll');
      await pollCryptoUntilPaid(created.invoiceId, gen, email);
    } catch (err) {
      setCryptoBusy(null);
      const msg = err instanceof BillingApiError ? err.message : err instanceof Error ? err.message : String(err);
      setCryptoMsg(`Crypto error: ${msg}`);
    }
  };

  const startRedeem = async () => {
    const email = effectiveBillingEmail();
    const code = redeemCode.trim();
    if (!email || !email.includes('@')) {
      setLicenseMsg('Enter email to redeem an access code.');
      return;
    }
    if (!code) {
      setLicenseMsg('Enter an access code to redeem.');
      return;
    }
    rememberEmail(email);
    setRedeemBusy(true);
    setLicenseMsg('Redeeming access code…');
    try {
      const deviceId = getOrCreateDeviceId(settings.deviceId);
      const result = await redeemAccessCode(settings, { code, email, deviceId });
      const key = normalizeLicenseKey(result.licenseKey);
      setLicenseDraft(key);
      const nextLicense = getLicenseState({ licenseKey: key });
      const boundDevice = (result.deviceId || deviceId).trim();
      const accountEmail = (result.email || email).trim();
      patch({
        licenseKey: key,
        maxConcurrentJobs: nextLicense.tier === 'admin' ? 16 : nextLicense.tier === 'free' ? 1 : 4,
        selfDeepenPasses: nextLicense.features.maxSelfDeepenPasses,
        deviceId: boundDevice || settings.deviceId,
        ...(result.loginId
          ? {
              loginId: result.loginId,
              accountLoggedIn: true,
              accountEmail,
              billingEmail: accountEmail,
            }
          : { billingEmail: accountEmail }),
      });
      if (boundDevice) setDeviceIdDisplay(boundDevice);
      if (result.loginId) setAuthLoginId(result.loginId);
      if (accountEmail) {
        setBillingEmail(accountEmail);
        setAuthEmail(accountEmail);
      }
      try {
        void window.ablitDesktop?.setLicense?.(key);
      } catch {
        /* ignore */
      }
      setRedeemCode('');
      setRedeemBusy(false);
      setLicenseMsg(
        `Redeemed — activated ${nextLicense.label}${result.loginId ? ` (loginId ${result.loginId})` : ''}.`,
      );
    } catch (err) {
      setRedeemBusy(false);
      const msg = err instanceof BillingApiError ? err.message : err instanceof Error ? err.message : String(err);
      setLicenseMsg(`Redeem error: ${msg}`);
    }
  };

  const updateMcp = (id: string, partial: Partial<McpServerConfig>) => {
    const next = (settings.mcpServers || []).map((s) => (s.id === id ? { ...s, ...partial } : s));
    patch({ mcpServers: next });
  };

  const wipe = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    wipeAll();
    setConfirming(false);
    onWiped();
  };

  const refreshMcp = async () => {
    setMcpHint('');
    if (!bridge.connected) {
      const ok = await bridge.waitUntilConnected(5000);
      if (!ok) {
        setMcpHint('Bridge disconnected — start it with: npm run bridge (ws://127.0.0.1:17322), then Refresh');
        setMcpTick((n) => n + 1);
        return;
      }
    }
    await syncMcpServers(settings.mcpServers || []);
    setMcpTick((n) => n + 1);
  };

  const connectOne = async (s: McpServerConfig) => {
    setMcpHint('');
    if (!s.name.trim()) {
      setMcpHint('Name is required before Connect.');
      return;
    }
    if (!s.command.trim()) {
      setMcpHint('Command is required before Connect (e.g. npx).');
      return;
    }
    setMcpBusyId(s.id);
    try {
      if (!bridge.connected) {
        const ok = await bridge.waitUntilConnected(5000);
        if (!ok) {
          setMcpHint('Bridge disconnected — start it with: npm run bridge (ws://127.0.0.1:17322), then Refresh');
          return;
        }
      }
      const list = (settings.mcpServers || []).map((row) =>
        row.id === s.id ? { ...row, enabled: true } : row,
      );
      if (!s.enabled) {
        patch({ mcpServers: list });
      }
      await syncMcpServers(list);
      setMcpTick((n) => n + 1);
      const st = getMcpServerState(s.id);
      if (st?.connected) {
        setMcpHint(`Connected ${s.name}: ${st.tools.length} tool(s)`);
      } else {
        setMcpHint(st?.error || `Failed to connect ${s.name}`);
      }
    } finally {
      setMcpBusyId(null);
    }
  };

  const disconnectOne = async (id: string) => {
    setMcpBusyId(id);
    setMcpHint('');
    try {
      await disconnectMcpServer(id);
      setMcpTick((n) => n + 1);
    } finally {
      setMcpBusyId(null);
    }
  };

  const statuses = getMcpServerStatuses();
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const servers = settings.mcpServers || [];
  const appRoot = bridge.currentAppRoot;
  const wsRoot = bridge.validWorkspaceRoot || bridge.currentRoot || '';
  const roots = skillRootHints({ appRoot, workspaceRoot: wsRoot });
  const refreshSkills = async () => {
    setSkillsBusy(true);
    try {
      if (!bridge.connected || settings.skillsEnabled === false) {
        setSkillRows([]);
        return;
      }
      const skills = await bridge.listSkills();
      setSkillRows(toCatalogEntries(skills));
    } catch {
      setSkillRows([]);
    } finally {
      setSkillsBusy(false);
    }
  };

  useEffect(() => {
    void refreshSkills();
  }, [settings.skillsEnabled, appRoot, wsRoot]);

  const license = getLicenseState(settings);
  const enabledMcp = countEnabledMcp(servers);

  return (
    <div className="h-full overflow-auto p-4">
      <header className="page-header">
        <div className="page-header-title">Settings</div>
        <p className="page-header-sub">Agent loop, safety, pairing, and MCP — saved locally.</p>
      </header>

      <div className="grid max-w-2xl gap-4">
        <Section title="System prompt" hint="Default system prompt for new sessions.">
          <textarea
            value={settings.systemPrompt}
            onChange={(e) => patch({ systemPrompt: e.target.value })}
            rows={5}
            className="field resize-y"
          />
        </Section>

        <Section title="Agent loop" hint="Turn budget, deepen, mid-run inject, and completion chips.">
          <FieldLabel label="Max agent turns (1–50)" hint="Hard stop for tool/agent loops per run.">
            <input
              type="number"
              min={1}
              max={50}
              value={settings.maxAgentTurns ?? 24}
              onChange={(e) => {
                const n = Number(e.target.value);
                const clamped = Number.isFinite(n) ? Math.min(50, Math.max(1, Math.floor(n))) : 24;
                patch({ maxAgentTurns: clamped });
              }}
              className="field field-num"
            />
          </FieldLabel>


          <FieldLabel
            label={`Max concurrent Jobs (1–${Number.isFinite(license.features.maxConcurrentJobs) ? license.features.maxConcurrentJobs : 4})`}
            hint={
              license.isFree
                ? 'Free tier: single-flight Jobs. Pro unlocks up to 4 parallel.'
                : 'How many background Jobs may run at once.'
            }
          >
            <input
              type="number"
              min={1}
              max={Number.isFinite(license.features.maxConcurrentJobs) ? license.features.maxConcurrentJobs : 16}
              value={Math.min(
                settings.maxConcurrentJobs ?? 1,
                Number.isFinite(license.features.maxConcurrentJobs) ? license.features.maxConcurrentJobs : 16,
              )}
              onChange={(e) => {
                const n = Number(e.target.value);
                const max = Number.isFinite(license.features.maxConcurrentJobs)
                  ? license.features.maxConcurrentJobs
                  : 4;
                const clamped = Number.isFinite(n) ? Math.min(max, Math.max(1, Math.floor(n))) : 1;
                patch({ maxConcurrentJobs: clamped });
              }}
              className="field field-num"
            />
          </FieldLabel>

          <SwitchRow
            label="Self-deepen answers"
            checked={settings.selfDeepenEnabled !== false}
            onChange={(v) => patch({ selfDeepenEnabled: v })}
            help="After a text-only answer, nudge the model to expand thin/missing spots. Stops early on [ANSWER_COMPLETE]. Pair with Completeness below for the Abliterated-only checklist (does not call Grok)."
          />

          <SwitchRow
            label="Deepen for completeness (Abliterated-only)"
            checked={settings.deepenCompleteness !== false}
            onChange={(v) => patch({ deepenCompleteness: v })}
            help="When self-deepen runs (or Jobs enqueue with the Completeness chip), inject the completeness checklist from deepenComplete.ts. Chat header/composer toggle stays in sync. No Grok/censored CLI path."
          />

          <FieldLabel label="Self-deepen passes (0–5)" hint="0 turns deepen off even if the toggle is on.">
            <input
              type="number"
              min={0}
              max={5}
              value={settings.selfDeepenPasses ?? 2}
              onChange={(e) => {
                const n = Number(e.target.value);
                const clamped = Number.isFinite(n) ? Math.min(5, Math.max(0, Math.floor(n))) : 2;
                patch({ selfDeepenPasses: clamped });
              }}
              className="field field-num"
            />
          </FieldLabel>

          <SwitchRow
            label="Mid-run message inject"
            checked={settings.midRunInjectEnabled !== false}
            onChange={(v) => patch({ midRunInjectEnabled: v })}
            help="Send further messages while the agent is busy. It finishes the current step, then integrates your note."
          />


          <SwitchRow
            label="Verify-strict profile"
            checked={settings.verifyStrictProfile === true}
            onChange={(v) =>
              patch(
                v
                  ? { ...settings, verifyStrictProfile: true, buildModeEnabled: true, skillsEnabled: true, deepenCompleteness: true, selfDeepenEnabled: true, planModeEnabled: false }
                  : { verifyStrictProfile: false },
              )
            }
            help="Preset: Build mode + skills + deepen completeness. Auto-injects the verify-strict skill on Build/large Jobs and Chat."
          />
          <SwitchRow
            label="Job worktrees (experimental)"
            checked={settings.jobWorktreesEnabled === true}
            onChange={(v) => patch({ jobWorktreesEnabled: v })}
            help="When on, Jobs create a real git worktree under .ablit/worktrees/<jobId> and set the bridge workspace root to that tree."
          />

          <SwitchRow
            label="Multi-agent fleets (experimental)"
            checked={settings.multiAgentEnabled === true}
            onChange={(v) => patch({ multiAgentEnabled: v })}
            help="Orchestrator + coder/tester/verifier over .ablit/task.json blackboard. Default off. Pair with Job worktrees for isolation."
          />

          <SwitchRow
            label="Completion footer chips"
            checked={settings.completionFooterEnabled !== false}
            onChange={(v) => patch({ completionFooterEnabled: v })}
            help="Finished answers with a Done/Continue footer show three one-click continue prompts."
          />

          <SwitchRow
            label="Use reasoning as answer when content is empty"
            checked={settings.coalesceReasoningToContent !== false}
            onChange={(v) => patch({ coalesceReasoningToContent: v })}
            help="R1-style models sometimes fill reasoning only. Promote that text into the main answer locally — no extra API call. Off = show reasoning panel only."
          />
        </Section>


        <Section
          title="Skills"
          hint="Reusable SKILL.md recipes. Workspace .ablit/skills and AGENTS.md auto-load into chat on session start."
        >
          <SwitchRow
            label="Enable skills"
            checked={settings.skillsEnabled !== false}
            onChange={(v) => patch({ skillsEnabled: v })}
            help="Inject the skills catalog. Workspace .ablit/skills bodies auto-load. AGENTS.md conventions load even when this is off."
          />
          <div className="mt-2 space-y-1 font-mono text-[11px] text-zinc-400">
            <div>Bundled: {roots.bundled}</div>
            <div>User: {roots.global}</div>
            <div>Workspace: {roots.workspace}</div>
            <div>
              Loaded: {skillRows.length} skill{skillRows.length === 1 ? '' : 's'}
              {skillsBusy ? ' (refreshing…)' : ''}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="chip" onClick={() => void refreshSkills()} disabled={skillsBusy}>
              Refresh
            </button>
            <span className="font-mono text-[10px] text-muted">
              Add skills under ~/.abliterated/skills/&lt;slug&gt;/SKILL.md or .ablit/skills/ in the workspace. See docs/SKILLS.md.
            </span>
          </div>
        </Section>

        <Section
          title="Web search"
          hint="Built-in web_search is keyless (Brave HTML, then Bing, then Wikipedia). Optional backends override when set."
        >
          <FieldLabel
            label="Brave Search API key"
            hint="Optional. If set, web_search uses api.search.brave.com first. Leave empty for keyless search."
          >
            <input
              type="password"
              autoComplete="off"
              value={settings.webSearchBraveKey}
              onChange={(e) => patch({ webSearchBraveKey: e.target.value })}
              placeholder="BSA..."
              className="field"
            />
          </FieldLabel>
          <FieldLabel
            label="SearxNG URL"
            hint="Optional. Example: http://127.0.0.1:8080 — must allow format=json."
          >
            <input
              value={settings.webSearchSearxUrl}
              onChange={(e) => patch({ webSearchSearxUrl: e.target.value })}
              placeholder="https://searx.example/search"
              className="field"
            />
          </FieldLabel>
        </Section>

        <Section title="Safety" hint="What the agent may write or execute on your machine.">
          <SwitchRow
            label="Remote host enabled"
            checked={settings.remoteHostEnabled}
            onChange={(v) => patch({ remoteHostEnabled: v })}
            help="Allow the localhost bridge / remote host features."
          />

          <SwitchRow
            label="Auto-accept file edits"
            checked={settings.autoAcceptEdits}
            onChange={(v) => patch({ autoAcceptEdits: v })}
            help="When a working directory is connected, agent code files already write there. This also applies diffs without an extra Apply click. Shell still needs Run unless Auto-run is on."
          />

          <SwitchRow
            label="Auto-run shell"
            danger
            checked={settings.autoRunShell}
            onChange={(v) => patch({ autoRunShell: v })}
            help="Danger: runs model shell tool calls on the localhost daemon without a Run click. Deadly commands are still refused."
          />
        </Section>

        <Section
          title="MemPalace"
          hint="Local-first verbatim memory (wings / rooms / drawers). Official CLI: uv tool install mempalace — docs at mempalaceofficial.com. First-class tools: memory_search, memory_save, memory_status, memory_wake."
        >
          <SwitchRow
            label="Enable MemPalace"
            checked={settings.mempalaceEnabled !== false}
            onChange={(v) =>
              patch({
                mempalaceEnabled: v,
                mcpServers: withMempalaceMcpServer(
                  settings.mcpServers,
                  v,
                  settings.mempalacePalacePath,
                ),
              })
            }
            help="When on, chat/jobs get wake-up context and memory_* tools. MCP server is added as mcp__mempalace__* if uvx is available."
          />
          <SwitchRow
            label="Auto-recall (wake-up)"
            checked={settings.mempalaceAutoRecall !== false}
            onChange={(v) => patch({ mempalaceAutoRecall: v })}
            help="Inject L0+L1 wake-up into the system prompt when the bridge is connected."
          />
          <SwitchRow
            label="Auto-save sessions"
            checked={settings.mempalaceAutoSave !== false}
            onChange={(v) => patch({ mempalaceAutoSave: v })}
            help="After each chat/job run, file the last user/assistant turn into the palace (wing = workspace name)."
          />
          <FieldLabel
            label="Palace path"
            hint="Empty = MemPalace default (~/.mempalace/palace). Sets MEMPALACE_PALACE_PATH for CLI and MCP."
          >
            <input
              value={settings.mempalacePalacePath}
              onChange={(e) => patch({ mempalacePalacePath: e.target.value })}
              placeholder="~/.mempalace/palace"
              className="field"
            />
          </FieldLabel>
          <FieldLabel
            label="Wing"
            hint="Empty = basename of the connected workspace. Used to scope search / save."
          >
            <input
              value={settings.mempalaceWing}
              onChange={(e) => patch({ mempalaceWing: e.target.value })}
              placeholder="workspace folder name"
              className="field"
            />
          </FieldLabel>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-ghost h-7 px-2 text-[10px]"
              disabled={mpBusy !== null}
              onClick={() => {
                setMpBusy('which');
                setMpHint('');
                void bridge
                  .waitUntilConnected(4000)
                  .then((ok) => {
                    if (!ok) throw new Error('Bridge disconnected — npm run bridge');
                    return bridge.mempalaceWhich();
                  })
                  .then((w) => setMpHint(w.ok ? `CLI: ${w.display}` : w.error || w.text || 'not found'))
                  .catch((e) => setMpHint(e instanceof Error ? e.message : String(e)))
                  .finally(() => setMpBusy(null));
              }}
            >
              Detect CLI
            </button>
            <button
              type="button"
              className="btn-primary h-7 px-2 text-[10px]"
              disabled={mpBusy !== null}
              onClick={() => {
                setMpBusy('install');
                setMpHint('Installing via uv tool install mempalace…');
                void bridge
                  .waitUntilConnected(4000)
                  .then((ok) => {
                    if (!ok) throw new Error('Bridge disconnected — npm run bridge');
                    return bridge.mempalaceInstall();
                  })
                  .then((t) => setMpHint(t || 'installed'))
                  .catch((e) => setMpHint(e instanceof Error ? e.message : String(e)))
                  .finally(() => setMpBusy(null));
              }}
            >
              Install
            </button>
            <button
              type="button"
              className="btn-ghost h-7 px-2 text-[10px]"
              disabled={mpBusy !== null}
              onClick={() => {
                setMpBusy('init');
                setMpHint('Initializing palace from the connected workspace…');
                void bridge
                  .waitUntilConnected(4000)
                  .then((ok) => {
                    if (!ok) throw new Error('Bridge disconnected — npm run bridge');
                    return bridge.mempalaceInit(wsRoot || undefined, {
                      palacePath: settings.mempalacePalacePath,
                    });
                  })
                  .then((t) => setMpHint(t || 'initialized'))
                  .catch((e) => setMpHint(e instanceof Error ? e.message : String(e)))
                  .finally(() => setMpBusy(null));
              }}
            >
              Init workspace
            </button>
            <button
              type="button"
              className="btn-ghost h-7 px-2 text-[10px]"
              disabled={mpBusy !== null}
              onClick={() => {
                setMpBusy('status');
                setMpHint('');
                void bridge
                  .waitUntilConnected(4000)
                  .then((ok) => {
                    if (!ok) throw new Error('Bridge disconnected — npm run bridge');
                    return bridge.mempalaceStatus({
                      palacePath: settings.mempalacePalacePath,
                      wing: settings.mempalaceWing,
                    });
                  })
                  .then((t) => setMpHint(t || '(empty)'))
                  .catch((e) => setMpHint(e instanceof Error ? e.message : String(e)))
                  .finally(() => setMpBusy(null));
              }}
            >
              Status
            </button>
            <button
              type="button"
              className="btn-ghost h-7 px-2 text-[10px]"
              onClick={() => {
                patch({
                  mempalaceEnabled: true,
                  mcpServers: withMempalaceMcpServer(
                    settings.mcpServers,
                    true,
                    settings.mempalacePalacePath,
                  ),
                });
                setMpHint(
                  `Added MCP ${MEMPALACE_CATALOG_ENTRY.command} ${MEMPALACE_CATALOG_ENTRY.args.join(' ')} — Connect it under MCP servers.`,
                );
              }}
            >
              Add MCP server
            </button>
          </div>
          {mpHint ? (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border bg-background px-2 py-1.5 font-mono text-[10px] text-zinc-300">
              {mpHint}
            </pre>
          ) : null}
        </Section>

        <Section title="Inference / pairing" hint="Pairing code for the localhost bridge. Inference endpoints live under API.">
          <div className="rounded border border-border bg-background px-3 py-2">
            <div className="font-mono text-[10px] uppercase text-muted">Pairing code</div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="font-mono text-lg tracking-[0.3em] text-zinc-100">{settings.pairingCode}</span>
              <button
                type="button"
                onClick={() => patch({ pairingCode: generatePairingCode() })}
                className="btn-ghost h-7 px-2 text-[10px]"
              >
                Regenerate
              </button>
            </div>
          </div>
        </Section>

        <Section
          title="MCP servers"
          hint="Stdio MCP via the localhost bridge. Tools appear as mcp__server__tool in chat/jobs. Orphan MCP procs are cleaned on Refresh/bridge restart."
        >
          <p className="font-mono text-[11px] text-muted">
            Example: <code className="text-zinc-400">npx -y @modelcontextprotocol/server-filesystem .</code>
          </p>

          {servers.length === 0 ? (
            <div className="rounded border border-dashed border-border bg-background px-3 py-4 text-center font-mono text-[11px] text-muted">
              No MCP servers
            </div>
          ) : (
            <div className="grid gap-2">
              {servers.map((s) => {
                const st = statusById.get(s.id);
                const connected = !!st?.connected;
                const busy = mcpBusyId === s.id;
                const missing = !s.name.trim() || !s.command.trim();
                return (
                  <div key={s.id} className="rounded border border-border bg-background p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={s.name}
                        onChange={(e) => updateMcp(s.id, { name: e.target.value })}
                        placeholder="name"
                        className="field field-sm py-0.5 text-[11px]"
                      />
                      <span
                        className={`status-badge${connected ? ' status-badge--ok' : st?.error ? ' status-badge--err' : ''}`}
                        data-mcp-tick={mcpTick}
                      >
                        {connected
                          ? `${st?.toolCount ?? 0} tools`
                          : st?.error
                            ? 'error'
                            : 'offline'}
                      </span>
                      <label className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-zinc-400">
                        enabled
                        <input
                          type="checkbox"
                          checked={s.enabled}
                          onChange={(e) => {
                            const want = e.target.checked;
                            if (want && !s.enabled) {
                              const nextCount = enabledMcp + 1;
                              if (nextCount > license.features.maxMcpServers) {
                                setMcpHint(
                                  `Free tier allows ${license.features.maxMcpServers} MCP server — enabling anyway (soft). Upgrade for unlimited.`,
                                );
                              }
                            }
                            updateMcp(s.id, { enabled: want });
                          }}
                        />
                      </label>
                      {connected ? (
                        <button
                          type="button"
                          disabled={busy}
                          className="btn-ghost h-7 px-2 text-[10px]"
                          onClick={() => void disconnectOne(s.id)}
                        >
                          Disconnect
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy || missing}
                          className="btn-primary h-7 px-2 text-[10px]"
                          onClick={() => void connectOne(s)}
                          title={missing ? 'Name and command required' : 'Connect this server'}
                        >
                          Connect
                        </button>
                      )}
                      <button
                        type="button"
                        className="font-mono text-[10px] text-red-300 hover:text-red-200"
                        onClick={() => {
                          void disconnectMcpServer(s.id).then(() => {
                            patch({ mcpServers: servers.filter((x) => x.id !== s.id) });
                            setMcpTick((n) => n + 1);
                          });
                        }}
                      >
                        remove
                      </button>
                    </div>
                    <div className="mt-1.5 truncate font-mono text-[10px] text-zinc-500" title={commandPreview(s)}>
                      {commandPreview(s)}
                    </div>
                    <input
                      value={s.command}
                      onChange={(e) => updateMcp(s.id, { command: e.target.value })}
                      placeholder="command e.g. npx"
                      className="field mt-1.5 py-0.5 text-[11px]"
                    />
                    <input
                      value={(s.args || []).join(' ')}
                      onChange={(e) =>
                        updateMcp(s.id, {
                          args: e.target.value.trim() ? e.target.value.trim().split(/\s+/) : [],
                        })
                      }
                      placeholder="args space-separated"
                      className="field mt-1 py-0.5 text-[11px]"
                    />
                    {missing ? (
                      <p className="mt-1 font-mono text-[10px] text-amber-400/90">
                        Name and command required to connect.
                      </p>
                    ) : null}
                    {st?.error && !connected ? (
                      <p className="mt-1 font-mono text-[10px] text-red-300/90">{st.error}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-ghost h-7 px-2 text-[10px]"
              onClick={() => {
                const row: McpServerConfig = {
                  id: uid('mcp'),
                  name: 'filesystem',
                  command: EXAMPLE_FILESYSTEM_MCP.command,
                  args: [...EXAMPLE_FILESYSTEM_MCP.args],
                  enabled: false,
                };
                patch({ mcpServers: [...servers, row] });
                setMcpHint('');
              }}
            >
              Add filesystem example
            </button>
            <button
              type="button"
              className="btn-ghost h-7 px-2 text-[10px]"
              onClick={() => {
                const row: McpServerConfig = {
                  id: uid('mcp'),
                  name: 'server',
                  command: '',
                  args: [],
                  enabled: true,
                };
                patch({ mcpServers: [...servers, row] });
                setMcpHint('');
              }}
            >
              Add blank
            </button>
            <button type="button" className="btn-primary h-7 px-2 text-[10px]" onClick={() => void refreshMcp()}>
              Connect / refresh all
            </button>
          </div>

          {mcpHint ? <p className="font-mono text-[11px] text-amber-400">{mcpHint}</p> : null}

          <div className="font-mono text-[10px] text-muted" data-mcp-tick={mcpTick}>
            {statuses.length === 0
              ? 'No sessions yet — enable a server, then Connect (bridge required).'
              : statuses
                  .map((s) => `${s.name}: ${s.connected ? `${s.toolCount} tools` : s.error || 'offline'}`)
                  .join(' · ')}
          </div>
        </Section>


        <Section
          title="Account"
          hint="Sign up or log in on abliterated.app. Device-bound loginId restores your license on this install."
        >
          {settings.accountLoggedIn ? (
            <>
              <div className="rounded border border-border bg-background px-3 py-2 font-mono text-[12px] text-zinc-200">
                <div className="text-[10px] uppercase text-muted">Signed in</div>
                <div className="mt-1">{settings.accountEmail || '(no email)'}</div>
                <div className="mt-1 text-[11px] text-muted">loginId: {settings.loginId || '—'}</div>
                <div className="mt-1 break-all text-[10px] text-muted">deviceId: {deviceIdDisplay || settings.deviceId || '—'}</div>
              </div>
              <button
                type="button"
                className="btn-ghost h-7 px-3 text-[10px]"
                disabled={authBusy}
                onClick={handleLogout}
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`h-7 px-3 text-[10px] ${authMode === 'login' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setAuthMode('login')}
                >
                  Log in
                </button>
                <button
                  type="button"
                  className={`h-7 px-3 text-[10px] ${authMode === 'signup' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setAuthMode('signup')}
                >
                  Sign up
                </button>
              </div>

              <FieldLabel label="Email" hint="Account email (also used as checkout receipt email when set).">
                <input
                  type="email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="field font-mono text-[12px]"
                  autoComplete="email"
                />
              </FieldLabel>
              <FieldLabel label="Password" hint={authMode === 'signup' ? 'At least 8 characters.' : 'Your abliterated.app password.'}>
                <input
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="••••••••"
                  className="field font-mono text-[12px]"
                  autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                />
              </FieldLabel>
              <button
                type="button"
                className="btn-primary h-7 px-3 text-[10px]"
                disabled={authBusy}
                onClick={() => void (authMode === 'signup' ? handleSignup() : handleLoginEmail())}
              >
                {authBusy ? 'Working…' : authMode === 'signup' ? 'Create account' : 'Log in'}
              </button>

              <div className="mt-2">
                <button
                  type="button"
                  className="btn-ghost h-7 px-2 text-[10px]"
                  onClick={() => setAuthAdvanced((v) => !v)}
                >
                  {authAdvanced ? 'Hide advanced' : 'Advanced: loginId + device'}
                </button>
              </div>
              {authAdvanced ? (
                <>
                  <FieldLabel label="loginId" hint="From redeem / prior signup — restores license when device matches.">
                    <input
                      value={authLoginId}
                      onChange={(e) => setAuthLoginId(e.target.value)}
                      placeholder="login_…"
                      className="field font-mono text-[12px]"
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </FieldLabel>
                  <FieldLabel label="deviceId" hint="Stable on this install (Electron userData or settings).">
                    <input
                      value={deviceIdDisplay}
                      readOnly
                      className="field font-mono text-[11px] text-muted"
                    />
                  </FieldLabel>
                  <button
                    type="button"
                    className="btn-primary h-7 px-3 text-[10px]"
                    disabled={authBusy}
                    onClick={() => void handleLoginWithLoginId()}
                  >
                    {authBusy ? 'Working…' : 'Log in with loginId'}
                  </button>
                </>
              ) : null}
            </>
          )}
          {authMsg ? <p className="font-mono text-[11px] text-sky-300">{authMsg}</p> : null}
        </Section>

        <Section
          title="Plan & upgrades"
          hint={`Starter $${PRICING_HINT.starterMonthly}/mo · Pro $${PRICING_HINT.proMonthly}/mo or $${PRICING_HINT.proYearly}/yr · Team $${PRICING_HINT.teamMonthlySeat}/mo seat.`}
        >
          <div className="rounded border border-border bg-background px-3 py-2">
            <div className="font-mono text-[10px] uppercase text-muted">Current plan</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-sky-700/60 bg-sky-950/40 px-2 py-0.5 font-mono text-[11px] text-sky-200">
                {license.label}
              </span>
              <span className="font-mono text-lg text-zinc-100">{license.tier}</span>
            </div>
            {license.features.showWatermark ? (
              <p className="mt-1 font-mono text-[11px] text-amber-400/90">Free watermark on — upgrade to remove.</p>
            ) : (
              <p className="mt-1 font-mono text-[11px] text-emerald-400/90">No watermark · priority features unlocked.</p>
            )}
          </div>

          <ul className="mt-2 list-inside list-disc font-mono text-[11px] text-muted">
            <li>
              MCP servers:{" "}
              {Number.isFinite(license.features.maxMcpServers) ? license.features.maxMcpServers : "unlimited"} (enabled
              now: {enabledMcp})
            </li>
            <li>
              Jobs concurrency: up to{' '}
              {Number.isFinite(license.features.maxConcurrentJobs)
                ? license.features.maxConcurrentJobs
                : 'unlimited'}
            </li>
            <li>Plan mode: {license.features.planModeAllowed ? 'allowed' : '—'}</li>
            <li>Shared seats: {license.features.sharedSeats ? 'Team placeholder' : '—'}</li>
            <li>
              Built-in unrestricted model:{' '}
              {license.features.maxIncludedTokens === 0
                ? 'not included — use Featherless.ai'
                : `${formatTokenCount(license.features.maxIncludedTokens)} tokens/mo`}
            </li>
          </ul>
          {license.features.maxIncludedTokens > 0 ? (
            <BuiltinTokenMeter license={license} />
          ) : null}

          <FieldLabel
            label="Billing email"
            hint={
              settings.accountEmail
                ? 'Uses accountEmail when set (else billingEmail) for Stripe / Solana / portal / crypto.'
                : 'Receipt email for checkout (stored locally). Sign in above to sync accountEmail.'
            }
          >
            <input
              type="email"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
              onBlur={() => rememberEmail(billingEmail)}
              placeholder="you@example.com"
              className="field font-mono text-[12px]"
              autoComplete="email"
            />
          </FieldLabel>

          <FieldLabel label="Plan" hint="Card or Solana USDC checkout — secrets stay on abliterated.app.">
            <select
              value={billingPlan}
              onChange={(e) => setBillingPlan(e.target.value as BillingPlan)}
              className="field font-mono text-[12px]"
            >
              {BILLING_PLANS.map((p) => (
                <option key={p} value={p}>
                  {BILLING_PLAN_LABELS[p]}
                </option>
              ))}
            </select>
          </FieldLabel>

          {billingPlan === 'team_monthly' ? (
            <FieldLabel label="Seats" hint="Team plan quantity (1–100).">
              <input
                type="number"
                min={1}
                max={100}
                value={billingSeats}
                onChange={(e) =>
                  setBillingSeats(Math.max(1, Math.min(100, Number(e.target.value) || 1)))
                }
                className="field font-mono text-[12px] w-24"
              />
            </FieldLabel>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary h-7 px-3 text-[10px]"
              disabled={planBusy === 'stripe'}
              onClick={() => void startStripeCheckout()}
            >
              {planBusy === 'stripe' ? 'Card…' : 'Pay with card'}
            </button>
            <button
              type="button"
              className="btn-primary h-7 px-3 text-[10px]"
              disabled={planBusy === 'solana'}
              onClick={() => void startSolanaCheckout()}
            >
              {planBusy === 'solana' ? 'Solana…' : 'Pay plan with Solana USDC'}
            </button>
            {pendingStripeSession ? (
              <button
                type="button"
                className="btn-ghost h-7 px-2 text-[10px]"
                disabled={planBusy === 'stripe'}
                onClick={() => {
                  const gen = ++pollAbortRef.current;
                  setPlanBusy('stripe');
                  void pollStripeUntilLicense(pendingStripeSession, gen);
                }}
              >
                Resume Stripe poll
              </button>
            ) : null}
            {pendingSolanaId ? (
              <button
                type="button"
                className="btn-ghost h-7 px-2 text-[10px]"
                disabled={planBusy === 'solana'}
                onClick={() => {
                  const gen = ++pollAbortRef.current;
                  setPlanBusy('solana');
                  void pollSolanaUntilLicense(pendingSolanaId, gen, effectiveBillingEmail());
                }}
              >
                Resume Solana poll
              </button>
            ) : null}
          </div>

          {solanaPayUrl ? (
            <div className="rounded border border-border bg-background px-3 py-2 font-mono text-[11px] text-zinc-200">
              <div className="text-[10px] uppercase text-muted">Solana pay link{solanaAmount ? ` · ${solanaAmount} USDC` : ''}</div>
              <div className="mt-1 break-all text-sky-300">{solanaPayUrl}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-ghost h-7 px-2 text-[10px]"
                  onClick={() => void openBillingUrl(solanaPayUrl)}
                >
                  Open
                </button>
                <button
                  type="button"
                  className="btn-ghost h-7 px-2 text-[10px]"
                  onClick={() => {
                    void navigator.clipboard?.writeText(solanaPayUrl);
                    setPlanMsg('Solana pay URL copied.');
                  }}
                >
                  Copy URL
                </button>
              </div>
            </div>
          ) : null}

          {planMsg ? <p className="font-mono text-[11px] text-sky-300">{planMsg}</p> : null}
        </Section>

        <Section
          title="Cards & billing"
          hint="Save a card (Stripe setup mode) or open the Customer Portal to manage subscription and payment methods."
        >
          <FieldLabel
            label="Billing email"
            hint="Required for portal and card setup. Prefers accountEmail || billingEmail."
          >
            <input
              type="email"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
              onBlur={() => rememberEmail(billingEmail)}
              placeholder="you@example.com"
              className="field font-mono text-[12px]"
              autoComplete="email"
            />
          </FieldLabel>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary h-7 px-3 text-[10px]"
              disabled={cardsBusy === 'setup'}
              onClick={() => void startSaveCard()}
            >
              {cardsBusy === 'setup' ? 'Opening…' : 'Save a card'}
            </button>
            <button
              type="button"
              className="btn-primary h-7 px-3 text-[10px]"
              disabled={cardsBusy === 'portal'}
              onClick={() => void startCustomerPortal()}
            >
              {cardsBusy === 'portal' ? 'Opening…' : 'Manage subscription & cards'}
            </button>
          </div>
          {cardsMsg ? (
            <p className={`font-mono text-[11px] ${cardsMsg.includes('error') || cardsMsg.includes('Error') ? 'text-amber-400' : 'text-sky-300'}`}>
              {cardsMsg}
            </p>
          ) : null}
        </Section>

        <Section
          title="Credits / crypto"
          hint="Prepaid app-credit packs via crypto (default USDC on Solana). Does not auto-renew."
        >
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-ghost h-7 px-2 text-[10px]"
              disabled={cryptoBusy === 'load'}
              onClick={() => void loadCryptoCatalog()}
            >
              {cryptoBusy === 'load' ? 'Loading…' : 'Refresh packs'}
            </button>
          </div>

          <FieldLabel label="Credit pack" hint="Loaded from GET /api/checkout/crypto (fallback: 5M / 20M / 50M).">
            <select
              value={creditPackId}
              onChange={(e) => setCreditPackId(e.target.value as CreditPackId)}
              className="field font-mono text-[12px]"
            >
              {creditPacks.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} — ${p.usd}
                </option>
              ))}
            </select>
          </FieldLabel>
          {creditPacks.find((p) => p.id === creditPackId)?.blurb ? (
            <p className="font-mono text-[11px] text-muted">
              {creditPacks.find((p) => p.id === creditPackId)?.blurb}
            </p>
          ) : null}

          <FieldLabel label="Asset" hint="Default usdc_sol (Solana USDC).">
            <select
              value={cryptoAsset}
              onChange={(e) => setCryptoAsset(e.target.value)}
              className="field font-mono text-[12px]"
            >
              <option value="usdc_sol">USDC · Solana (usdc_sol)</option>
              <option value="sol">SOL</option>
              <option value="usdc_erc20">USDC · Ethereum</option>
              <option value="usdt_erc20">USDT · Ethereum</option>
              <option value="eth">ETH</option>
              <option value="btc">BTC</option>
              <option value="usdt_trc20">USDT · TRON</option>
              <option value="trx">TRX</option>
            </select>
          </FieldLabel>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary h-7 px-3 text-[10px]"
              disabled={cryptoBusy === 'create' || cryptoBusy === 'poll'}
              onClick={() => void startCryptoCheckout()}
            >
              {cryptoBusy === 'create' ? 'Creating…' : cryptoBusy === 'poll' ? 'Waiting…' : 'Pay with crypto'}
            </button>
            {pendingCryptoId ? (
              <button
                type="button"
                className="btn-ghost h-7 px-2 text-[10px]"
                disabled={cryptoBusy === 'poll'}
                onClick={() => {
                  const gen = ++cryptoPollAbortRef.current;
                  setCryptoBusy('poll');
                  void pollCryptoUntilPaid(pendingCryptoId, gen, effectiveBillingEmail());
                }}
              >
                Resume crypto poll
              </button>
            ) : null}
          </div>

          {cryptoPayUrl || cryptoPayUri ? (
            <div className="rounded border border-border bg-background px-3 py-2 font-mono text-[11px] text-zinc-200">
              <div className="text-[10px] uppercase text-muted">
                Crypto pay{cryptoAmountLabel ? ` · ${cryptoAmountLabel}` : ''}
                {pendingCryptoId ? ` · ${pendingCryptoId.slice(0, 10)}…` : ''}
              </div>
              {cryptoPayUrl ? (
                <>
                  <div className="mt-1 text-[10px] uppercase text-muted">Checkout page</div>
                  <div className="mt-0.5 break-all text-sky-300">{cryptoPayUrl}</div>
                </>
              ) : null}
              {cryptoPayUri ? (
                <>
                  <div className="mt-2 text-[10px] uppercase text-muted">Payment URI</div>
                  <div className="mt-0.5 break-all text-sky-300">{cryptoPayUri}</div>
                </>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {cryptoPayUrl ? (
                  <>
                    <button
                      type="button"
                      className="btn-ghost h-7 px-2 text-[10px]"
                      onClick={() => void openBillingUrl(cryptoPayUrl)}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="btn-ghost h-7 px-2 text-[10px]"
                      onClick={() => {
                        void navigator.clipboard?.writeText(cryptoPayUrl);
                        setCryptoMsg('Crypto checkout URL copied.');
                      }}
                    >
                      Copy URL
                    </button>
                  </>
                ) : null}
                {cryptoPayUri ? (
                  <button
                    type="button"
                    className="btn-ghost h-7 px-2 text-[10px]"
                    onClick={() => {
                      void navigator.clipboard?.writeText(cryptoPayUri);
                      setCryptoMsg('Payment URI copied.');
                    }}
                  >
                    Copy URI
                  </button>
                ) : null}
              </div>
              <p className="mt-2 font-mono text-[10px] text-muted">
                Prepaid credits — no subscription auto-renew.
              </p>
            </div>
          ) : null}

          {cryptoMsg ? <p className="font-mono text-[11px] text-sky-300">{cryptoMsg}</p> : null}
        </Section>

        <Section
          title="License"
          hint="Paste an ABLIT-* key or redeem a one-time access code (device-bound)."
        >
          <FieldLabel label="Redeem access code" hint="One-time code from waitlist / promo — bound to this device.">
            <input
              value={redeemCode}
              onChange={(e) => setRedeemCode(e.target.value)}
              placeholder="ACCESS-…"
              className="field font-mono text-[12px]"
              spellCheck={false}
              autoComplete="off"
            />
          </FieldLabel>
          <button
            type="button"
            className="btn-primary h-7 px-3 text-[10px]"
            disabled={redeemBusy}
            onClick={() => void startRedeem()}
          >
            {redeemBusy ? 'Redeeming…' : 'Redeem code'}
          </button>

          <FieldLabel label="License key" hint="Paste your ABLIT-* license key from checkout or redeem. Or Sign up / Log in above — login returns licenseKey when bound.">
            <input
              value={licenseDraft}
              onChange={(e) => setLicenseDraft(e.target.value)}
              placeholder="ABLIT-STARTER-XXXX-XXXX / ABLIT-PRO-XXXX-XXXX"
              className="field font-mono text-[12px]"
              spellCheck={false}
              autoComplete="off"
            />
          </FieldLabel>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary h-7 px-3 text-[10px]"
              onClick={() => {
                const key = normalizeLicenseKey(licenseDraft);
                const next = persistLicense(key);
                setLicenseMsg(
                  key
                    ? `Activated ${next.label}${next.isFree && key ? " (unrecognized key → Free)" : ""}.`
                    : "Cleared — Free tier.",
                );
              }}
            >
              Activate
            </button>
            <button
              type="button"
              className="btn-ghost h-7 px-2 text-[10px]"
              onClick={() => {
                persistLicense(LICENSE_TEST_KEYS.free);
                setLicenseMsg('Forced Free (ABLIT-FREE) to test gates. Paste your license key above to restore.');
              }}
            >
              Test Free gates
            </button>
          </div>
          {licenseMsg ? <p className="font-mono text-[11px] text-sky-300">{licenseMsg}</p> : null}
          <p className="font-mono text-[10px] text-muted">
            Billing calls abliterated.app APIs only — no Stripe secrets in this client. See docs/PRODUCT.md.
          </p>
        </Section>

        <Section title="Documentation" hint="In-app guide served by Vite from public/docs while the DEV server runs.">
          <a
            href="/docs/"
            target="_blank"
            rel="noreferrer"
            className="btn-primary inline-flex"
          >
            App docs
          </a>
          <p className="mt-2 font-mono text-[11px] text-muted">
            Opens /docs/ in a new tab (http://127.0.0.1:5173/docs/). Raw markdown: /docs/APP.md
          </p>
        </Section>

        <Section title="Danger zone" hint="Wipe settings, threads, messages, jobs, and workspace from localStorage." danger>
          <button type="button" onClick={wipe} className="btn-danger">
            {confirming ? 'Click again to confirm wipe' : 'Wipe all'}
          </button>
        </Section>
      </div>
    </div>
  );
}
