import { useEffect, useRef, useState } from 'react';
import { bridge } from '../lib/bridgeClient';
import {
  disconnectMcpServer,
  getMcpServerStatuses,
  syncMcpServers,
} from '../lib/mcpClient';
import {
  countEnabledMcp,
  getLicenseState,
  normalizeLicenseKey,
} from '../lib/license';
import {
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
import { setSettings, wipeAll } from '../lib/storage';
import { skillRootHints, toCatalogEntries, type SkillCatalogEntry } from '../lib/skills';
import {
  AGENT_SETUP_PROFILES,
  applyAgentSetup,
  detectActiveSetup,
  alignSetupForProvider,
  checkProviderAlignment,
  getProviderSetupAlignment,
  type AgentSetupId,
} from '../lib/agentPresets';
import { resolveActiveSettings } from '../lib/activeEndpoint';
import type { ClientSettings, McpServerConfig, InferenceProvider } from '../types';

import {
  SettingsHeader,
  SettingsNavSidebar,
  getSettingsTabs,
  type SettingsTabId,
} from '../components/settings/SettingsNav';
import { AgentTab } from '../components/settings/AgentTab';
import { SafetyTab } from '../components/settings/SafetyTab';
import { MemoryTab } from '../components/settings/MemoryTab';
import { ToolsTab } from '../components/settings/ToolsTab';
import { BillingTab } from '../components/settings/BillingTab';
import { AccountTab } from '../components/settings/AccountTab';
import { SystemTab } from '../components/settings/SystemTab';
import { SettingsSearchResults } from '../components/settings/SettingsSearchResults';

interface Props {
  settings: ClientSettings;
  onSettingsChange: (s: ClientSettings) => void;
  onWiped: () => void;
}

export function SettingsScreen({ settings, onSettingsChange, onWiped }: Props) {
  // Navigation & Search State
  const [currentTab, setCurrentTab] = useState<SettingsTabId>('agent');
  const [searchQuery, setSearchQuery] = useState('');
  const [bridgeConnected, setBridgeConnected] = useState(bridge.connected);

  useEffect(() => {
    return bridge.onStatusChange(() => {
      setBridgeConnected(bridge.connected);
    });
  }, []);

  // Wipe / Confirmation State
  const [confirming, setConfirming] = useState(false);

  // MCP State
  const [mcpTick, setMcpTick] = useState(0);
  const [mcpBusyId, setMcpBusyId] = useState<string | null>(null);
  const [mcpHint, setMcpHint] = useState('');

  // License State
  const [licenseDraft, setLicenseDraft] = useState(settings.licenseKey || '');
  const [licenseMsg, setLicenseMsg] = useState('');

  // Account / Auth State
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

  // Billing / Plans State
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

  // Crypto Credits State
  const [cryptoBusy, setCryptoBusy] = useState<'load' | 'create' | 'poll' | null>(null);
  const [cryptoMsg, setCryptoMsg] = useState('');
  const [creditPacks, setCreditPacks] = useState<CreditPack[]>([...FALLBACK_CREDIT_PACKS]);
  const [creditPackId, setCreditPackId] = useState<CreditPackId>('credits_20m');
  const [cryptoAsset, setCryptoAsset] = useState('usdc_sol');
  const [pendingCryptoId, setPendingCryptoId] = useState<string | null>(null);
  const [cryptoPayUrl, setCryptoPayUrl] = useState('');
  const [cryptoPayUri, setCryptoPayUri] = useState('');
  const [cryptoAmountLabel, setCryptoAmountLabel] = useState('');

  // Skills State
  const [skillRows, setSkillRows] = useState<SkillCatalogEntry[]>([]);
  const [skillsBusy, setSkillsBusy] = useState(false);

  // MemPalace State
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.deviceId]);

  useEffect(() => {
    return () => {
      pollAbortRef.current += 1;
      cryptoPollAbortRef.current += 1;
    };
  }, []);

  const loadCryptoCatalog = async () => {
    setCryptoBusy('load');
    try {
      const meta = await listCryptoCheckout(settings);
      const packs = meta.packs.length ? meta.packs : [...FALLBACK_CREDIT_PACKS];
      setCreditPacks(packs);
      setCreditPackId((prev) => (packs.some((p) => p.id === prev) ? prev : packs[0]?.id || 'credits_20m'));
      setCryptoMsg(
        meta.facilitator
          ? `Loaded ${packs.length} packs (${meta.facilitator}). Prepaid crypto — no auto-renew.`
          : `Loaded ${packs.length} packs. Prepaid crypto — no auto-renew.`,
      );
    } catch (err) {
      setCreditPacks([...FALLBACK_CREDIT_PACKS]);
      const msg =
        err instanceof BillingApiError ? err.message : err instanceof Error ? err.message : String(err);
      setCryptoMsg(`Using static packs (${msg}). Prepaid — no auto-renew.`);
    } finally {
      setCryptoBusy(null);
    }
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
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
        setCryptoMsg(`Using static packs (${msg}). Prepaid — no auto-renew.`);
      } finally {
        if (alive) setCryptoBusy(null);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const resolvedDeviceId = (await ensureDeviceId(settings)) || '';
    const deviceId = (result.deviceId || deviceIdDisplay || resolvedDeviceId).trim();
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
      const deviceId = (await ensureDeviceId(settings, (id) => {
        if (id !== (settings.deviceId || '')) patch({ deviceId: id });
        setDeviceIdDisplay(id);
      })) || '';
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
      const deviceId = (await ensureDeviceId(settings, (id) => {
        if (id !== (settings.deviceId || '')) patch({ deviceId: id });
        setDeviceIdDisplay(id);
      })) || '';
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
      const deviceId = (await ensureDeviceId(settings, (id) => {
        if (id !== (settings.deviceId || '')) patch({ deviceId: id });
        setDeviceIdDisplay(id);
      })) || '';
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
            /* ignore */
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
        setPlanMsg('Opened Stripe checkout. Paste license key if not auto-applied.');
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
      setCardsMsg('Enter your billing email to open the customer portal.');
      return;
    }
    rememberEmail(email);
    setCardsBusy('portal');
    setCardsMsg('Opening customer portal…');
    try {
      const created = await openCustomerPortal(settings, { email });
      await openBillingUrl(created.url);
      setCardsMsg('Opened Stripe Customer Portal.');
    } catch (err) {
      const msg = err instanceof BillingApiError ? err.message : err instanceof Error ? err.message : String(err);
      setCardsMsg(`Portal error: ${msg}`);
    } finally {
      setCardsBusy(null);
    }
  };

  const pollCryptoUntilPaid = async (invoiceId: string, gen: number, email: string) => {
    setCryptoMsg(`Waiting for crypto payment (invoice ${invoiceId.slice(0, 12)}…)…`);
    for (let i = 0; i < 120; i++) {
      if (cryptoPollAbortRef.current !== gen) return;
      try {
        let inv = await getCryptoInvoice(settings, invoiceId);
        if (inv.status === 'pending' || inv.status === 'created') {
          try {
            const confirmed = await confirmCryptoInvoice(settings, { invoiceId, email: email || undefined });
            if (confirmed.status) inv = { ...inv, status: confirmed.status };
          } catch {
            /* ignore */
          }
        }
        if (inv.status === 'paid' || inv.status === 'confirmed' || inv.status === 'complete') {
          setPendingCryptoId(null);
          setCryptoBusy(null);
          setCryptoMsg('Crypto invoice paid. Credits applied.');
          return;
        }
        if (inv.status === 'expired') {
          setCryptoBusy(null);
          setCryptoMsg('Crypto invoice expired. Start a new checkout.');
          return;
        }
        setCryptoMsg(`Crypto: ${inv.status || 'pending'} (${i + 1})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setCryptoMsg(`Crypto poll: ${msg}`);
      }
      await sleep(3500);
    }
    setCryptoBusy(null);
    setCryptoMsg('Crypto checkout timed out waiting for confirmation.');
  };

  const startCryptoCheckout = async () => {
    const email = effectiveBillingEmail();
    if (!email || !email.includes('@')) {
      setCryptoMsg('Enter a receipt email before paying with crypto.');
      return;
    }
    rememberEmail(email);
    const gen = ++cryptoPollAbortRef.current;
    setCryptoBusy('create');
    setCryptoMsg('Creating crypto invoice…');
    try {
      const created = await createCryptoInvoice(settings, {
        creditPackId,
        asset: cryptoAsset,
        email,
      });
      setPendingCryptoId(created.invoiceId);
      setCryptoPayUrl(created.url || '');
      setCryptoPayUri(created.uri || '');
      setCryptoAmountLabel(created.amountCrypto ? `${created.amountCrypto} ${created.asset || ''}` : '');
      if (created.url) await openBillingUrl(created.url);
      setCryptoMsg('Crypto invoice ready. Waiting for network confirmation…');
      setCryptoBusy('poll');
      await pollCryptoUntilPaid(created.invoiceId, gen, email);
    } catch (err) {
      setCryptoBusy(null);
      const msg = err instanceof BillingApiError ? err.message : err instanceof Error ? err.message : String(err);
      setCryptoMsg(`Crypto error: ${msg}`);
    }
  };

  const startRedeem = async () => {
    const code = redeemCode.trim();
    if (!code) {
      setLicenseMsg('Enter an access code first.');
      return;
    }
    const email = effectiveBillingEmail();
    if (!email || !email.includes('@')) {
      setLicenseMsg('Enter a receipt email before redeeming an access code.');
      return;
    }
    setRedeemBusy(true);
    setLicenseMsg('Redeeming access code…');
    try {
      const deviceId = (await ensureDeviceId(settings, (id) => {
        if (id !== (settings.deviceId || '')) patch({ deviceId: id });
        setDeviceIdDisplay(id);
      })) || '';
      const res = await redeemAccessCode(settings, {
        code,
        deviceId,
        email,
      });
      if (res.licenseKey) {
        const next = persistLicense(res.licenseKey);
        setLicenseMsg(`Redeemed code! Activated ${next.label}.`);
        setRedeemCode('');
      } else {
        setLicenseMsg('Code redeemed successfully.');
      }
    } catch (err) {
      const msg = err instanceof BillingApiError ? err.message : err instanceof Error ? err.message : String(err);
      setLicenseMsg(`Redeem error: ${msg}`);
    } finally {
      setRedeemBusy(false);
    }
  };

  const wipe = () => {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 4000);
      return;
    }
    wipeAll();
    onWiped();
  };

  const servers = settings.mcpServers ?? [];
  const statusById = new Map(getMcpServerStatuses().map((s) => [s.id, s]));
  const statuses = getMcpServerStatuses();

  const updateMcp = (id: string, partial: Partial<McpServerConfig>) => {
    const list = servers.map((s) => (s.id === id ? { ...s, ...partial } : s));
    patch({ mcpServers: list });
  };

  const disconnectOne = async (id: string) => {
    setMcpBusyId(id);
    try {
      await disconnectMcpServer(id);
      setMcpTick((n) => n + 1);
    } finally {
      setMcpBusyId(null);
    }
  };

  const connectOne = async (s: McpServerConfig) => {
    setMcpBusyId(s.id);
    setMcpHint(`Connecting ${s.name}…`);
    try {
      const next = servers.map((x) => (x.id === s.id ? { ...s, enabled: true } : x));
      patch({ mcpServers: next });
      await syncMcpServers(next);
      setMcpTick((n) => n + 1);
      const st = getMcpServerStatuses().find((x) => x.id === s.id);
      setMcpHint(st?.connected ? `Connected ${s.name}: ${st.toolCount} tool(s)` : st?.error || `Connected ${s.name}`);
    } catch (e) {
      setMcpHint(e instanceof Error ? e.message : String(e));
    } finally {
      setMcpBusyId(null);
    }
  };

  const appRoot = bridge.currentAppRoot;
  const wsRoot = bridge.validWorkspaceRoot;
  const roots = skillRootHints({ appRoot, workspaceRoot: wsRoot });

  const refreshSkills = async () => {
    setSkillsBusy(true);
    try {
      if (!bridge.connected) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.skillsEnabled, appRoot, wsRoot]);

  const license = getLicenseState(settings);
  const enabledMcp = countEnabledMcp(servers);
  const [selectedSetupId, setSelectedSetupId] = useState<AgentSetupId>(
    () => detectActiveSetup(settings).activeSetup.id,
  );
  const [presetToast, setPresetToast] = useState('');
  const setupAnalysis = detectActiveSetup(settings);

  const handleSelectSetup = (setupId: AgentSetupId) => {
    setSelectedSetupId(setupId);
    const patched = applyAgentSetup(settings, setupId);
    patch(patched);
    const prof = AGENT_SETUP_PROFILES.find((p) => p.id === setupId);
    setPresetToast(`Configured all switches for ${prof?.name || setupId}`);
    setTimeout(() => setPresetToast(''), 4000);
  };

  const activeEndpoint = resolveActiveSettings(settings);
  const activeProvider: InferenceProvider = settings.inferenceProvider ?? 'abliteration';
  const providerStatus = checkProviderAlignment(settings, activeProvider);

  const handleAlignToProvider = (provider: InferenceProvider) => {
    const nextSettings = alignSetupForProvider(settings, provider);
    patch(nextSettings);
    const alignment = getProviderSetupAlignment(provider);
    setSelectedSetupId(alignment.recommendedSetupId);
    setPresetToast(`Optimized setup, turn budget & switches for ${alignment.name}`);
    setTimeout(() => setPresetToast(''), 4500);
  };

  const tabs = getSettingsTabs(license, enabledMcp, setupAnalysis.divergentCount, bridgeConnected);

  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Navigation & Universal Search Header */}
        <SettingsHeader
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          license={license}
        />

        {/* Tab Content or Universal Search Results */}
        {searchQuery.trim() ? (
          <SettingsSearchResults
            query={searchQuery}
            settings={settings}
            patch={patch}
            selectedSetupId={selectedSetupId}
            onNavigateToTab={(tab) => {
              setSearchQuery('');
              setCurrentTab(tab);
            }}
          />
        ) : (
          <div className="flex flex-col md:flex-row gap-6 items-start">
            {/* Left Nav Sidebar */}
            <aside className="w-full md:w-64 shrink-0 md:sticky md:top-0">
              <SettingsNavSidebar
                currentTab={currentTab}
                onTabChange={setCurrentTab}
                tabs={tabs}
              />
            </aside>

            {/* Right Active Tab Content */}
            <main className="flex-1 min-w-0 w-full">
              {currentTab === 'agent' && (
                <AgentTab
                  settings={settings}
                  patch={patch}
                  license={license}
                  selectedSetupId={selectedSetupId}
                  onSelectSetup={handleSelectSetup}
                  setupAnalysis={setupAnalysis}
                  toast={presetToast}
                  activeProvider={activeProvider}
                  providerStatus={providerStatus}
                  onAlignToProvider={handleAlignToProvider}
                  activeEndpoint={activeEndpoint}
                />
              )}

              {currentTab === 'safety' && (
                <SafetyTab
                  settings={settings}
                  patch={patch}
                  selectedSetupId={selectedSetupId}
                />
              )}

              {currentTab === 'memory' && (
                <MemoryTab
                  settings={settings}
                  patch={patch}
                  selectedSetupId={selectedSetupId}
                  mpHint={mpHint}
                  setMpHint={setMpHint}
                  mpBusy={mpBusy}
                  setMpBusy={setMpBusy}
                  wsRoot={wsRoot}
                />
              )}

              {currentTab === 'tools' && (
                <ToolsTab
                  settings={settings}
                  patch={patch}
                  license={license}
                  servers={servers}
                  statusById={statusById}
                  statuses={statuses}
                  enabledMcp={enabledMcp}
                  mcpTick={mcpTick}
                  setMcpTick={setMcpTick}
                  mcpBusyId={mcpBusyId}
                  setMcpBusyId={setMcpBusyId}
                  mcpHint={mcpHint}
                  setMcpHint={setMcpHint}
                  disconnectOne={disconnectOne}
                  connectOne={connectOne}
                  updateMcp={updateMcp}
                  roots={roots}
                  skillRows={skillRows}
                  skillsBusy={skillsBusy}
                  refreshSkills={refreshSkills}
                  selectedSetupId={selectedSetupId}
                />
              )}

              {currentTab === 'billing' && (
                <BillingTab
                  settings={settings}
                  license={license}
                  enabledMcp={enabledMcp}
                  licenseDraft={licenseDraft}
                  setLicenseDraft={setLicenseDraft}
                  licenseMsg={licenseMsg}
                  setLicenseMsg={setLicenseMsg}
                  persistLicense={persistLicense}
                  redeemCode={redeemCode}
                  setRedeemCode={setRedeemCode}
                  redeemBusy={redeemBusy}
                  startRedeem={startRedeem}
                  billingEmail={billingEmail}
                  setBillingEmail={setBillingEmail}
                  rememberEmail={rememberEmail}
                  billingPlan={billingPlan}
                  setBillingPlan={setBillingPlan}
                  billingSeats={billingSeats}
                  setBillingSeats={setBillingSeats}
                  planBusy={planBusy}
                  planMsg={planMsg}
                  setPlanMsg={setPlanMsg}
                  startStripeCheckout={startStripeCheckout}
                  startSolanaCheckout={startSolanaCheckout}
                  pendingStripeSession={pendingStripeSession}
                  pollStripeUntilLicense={pollStripeUntilLicense}
                  pendingSolanaId={pendingSolanaId}
                  pollSolanaUntilLicense={pollSolanaUntilLicense}
                  effectiveBillingEmail={effectiveBillingEmail}
                  pollAbortRef={pollAbortRef}
                  setPlanBusy={setPlanBusy}
                  solanaPayUrl={solanaPayUrl}
                  solanaAmount={solanaAmount}
                  cardsBusy={cardsBusy}
                  cardsMsg={cardsMsg}
                  startSaveCard={startSaveCard}
                  startCustomerPortal={startCustomerPortal}
                  cryptoBusy={cryptoBusy}
                  loadCryptoCatalog={loadCryptoCatalog}
                  creditPackId={creditPackId}
                  setCreditPackId={setCreditPackId}
                  creditPacks={creditPacks}
                  cryptoAsset={cryptoAsset}
                  setCryptoAsset={setCryptoAsset}
                  startCryptoCheckout={startCryptoCheckout}
                  pendingCryptoId={pendingCryptoId}
                  cryptoPollAbortRef={cryptoPollAbortRef}
                  setCryptoBusy={setCryptoBusy}
                  pollCryptoUntilPaid={pollCryptoUntilPaid}
                  cryptoPayUrl={cryptoPayUrl}
                  cryptoPayUri={cryptoPayUri}
                  cryptoAmountLabel={cryptoAmountLabel}
                  cryptoMsg={cryptoMsg}
                  setCryptoMsg={setCryptoMsg}
                />
              )}

              {currentTab === 'account' && (
                <AccountTab
                  settings={settings}
                  authMode={authMode}
                  setAuthMode={setAuthMode}
                  authEmail={authEmail}
                  setAuthEmail={setAuthEmail}
                  authPassword={authPassword}
                  setAuthPassword={setAuthPassword}
                  authLoginId={authLoginId}
                  setAuthLoginId={setAuthLoginId}
                  authAdvanced={authAdvanced}
                  setAuthAdvanced={setAuthAdvanced}
                  authBusy={authBusy}
                  authMsg={authMsg}
                  deviceIdDisplay={deviceIdDisplay}
                  handleLogout={handleLogout}
                  handleSignup={handleSignup}
                  handleLoginEmail={handleLoginEmail}
                  handleLoginWithLoginId={handleLoginWithLoginId}
                />
              )}

              {currentTab === 'system' && (
                <SystemTab
                  confirming={confirming}
                  wipe={wipe}
                />
              )}
            </main>
          </div>
        )}
      </div>
    </div>
  );
}
