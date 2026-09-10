import { Section, FieldLabel, BuiltinTokenMeter } from './SettingsShared';
import {
  PRICING_HINT,
  LICENSE_TEST_KEYS,
  normalizeLicenseKey,
  type LicenseState,
} from '../../lib/license';
import {
  BILLING_PLAN_LABELS,
  BILLING_PLANS,
  openBillingUrl,
  type BillingPlan,
  type CreditPack,
  type CreditPackId,
} from '../../lib/billingApi';
import { formatTokenCount } from '../../lib/builtinTokens';
import type { ClientSettings } from '../../types';

export interface BillingTabProps {
  settings: ClientSettings;
  license: LicenseState;
  enabledMcp: number;
  licenseDraft: string;
  setLicenseDraft: React.Dispatch<React.SetStateAction<string>>;
  licenseMsg: string;
  setLicenseMsg: React.Dispatch<React.SetStateAction<string>>;
  persistLicense: (key: string) => LicenseState;
  redeemCode: string;
  setRedeemCode: React.Dispatch<React.SetStateAction<string>>;
  redeemBusy: boolean;
  startRedeem: () => Promise<void>;
  billingEmail: string;
  setBillingEmail: React.Dispatch<React.SetStateAction<string>>;
  rememberEmail: (email: string) => void;
  billingPlan: BillingPlan;
  setBillingPlan: React.Dispatch<React.SetStateAction<BillingPlan>>;
  billingSeats: number;
  setBillingSeats: React.Dispatch<React.SetStateAction<number>>;
  planBusy: 'stripe' | 'solana' | null;
  planMsg: string;
  setPlanMsg: React.Dispatch<React.SetStateAction<string>>;
  startStripeCheckout: () => Promise<void>;
  startSolanaCheckout: () => Promise<void>;
  pendingStripeSession: string | null;
  pollStripeUntilLicense: (sessionId: string, gen: number) => Promise<void>;
  pendingSolanaId: string | null;
  pollSolanaUntilLicense: (paymentId: string, gen: number, email: string) => Promise<void>;
  effectiveBillingEmail: () => string;
  pollAbortRef: React.MutableRefObject<number>;
  setPlanBusy: React.Dispatch<React.SetStateAction<'stripe' | 'solana' | null>>;
  solanaPayUrl: string;
  solanaAmount: string;
  cardsBusy: 'setup' | 'portal' | null;
  cardsMsg: string;
  startSaveCard: () => Promise<void>;
  startCustomerPortal: () => Promise<void>;
  cryptoBusy: 'load' | 'create' | 'poll' | null;
  loadCryptoCatalog: () => Promise<void>;
  creditPackId: CreditPackId;
  setCreditPackId: React.Dispatch<React.SetStateAction<CreditPackId>>;
  creditPacks: CreditPack[];
  cryptoAsset: string;
  setCryptoAsset: React.Dispatch<React.SetStateAction<string>>;
  startCryptoCheckout: () => Promise<void>;
  pendingCryptoId: string | null;
  cryptoPollAbortRef: React.MutableRefObject<number>;
  setCryptoBusy: React.Dispatch<React.SetStateAction<'load' | 'create' | 'poll' | null>>;
  pollCryptoUntilPaid: (invoiceId: string, gen: number, email: string) => Promise<void>;
  cryptoPayUrl: string;
  cryptoPayUri: string;
  cryptoAmountLabel: string;
  cryptoMsg: string;
  setCryptoMsg: React.Dispatch<React.SetStateAction<string>>;
}

export function BillingTab({
  settings,
  license,
  enabledMcp,
  licenseDraft,
  setLicenseDraft,
  licenseMsg,
  setLicenseMsg,
  persistLicense,
  redeemCode,
  setRedeemCode,
  redeemBusy,
  startRedeem,
  billingEmail,
  setBillingEmail,
  rememberEmail,
  billingPlan,
  setBillingPlan,
  billingSeats,
  setBillingSeats,
  planBusy,
  planMsg,
  setPlanMsg,
  startStripeCheckout,
  startSolanaCheckout,
  pendingStripeSession,
  pollStripeUntilLicense,
  pendingSolanaId,
  pollSolanaUntilLicense,
  effectiveBillingEmail,
  pollAbortRef,
  setPlanBusy,
  solanaPayUrl,
  solanaAmount,
  cardsBusy,
  cardsMsg,
  startSaveCard,
  startCustomerPortal,
  cryptoBusy,
  loadCryptoCatalog,
  creditPackId,
  setCreditPackId,
  creditPacks,
  cryptoAsset,
  setCryptoAsset,
  startCryptoCheckout,
  pendingCryptoId,
  cryptoPollAbortRef,
  setCryptoBusy,
  pollCryptoUntilPaid,
  cryptoPayUrl,
  cryptoPayUri,
  cryptoAmountLabel,
  cryptoMsg,
  setCryptoMsg,
}: BillingTabProps) {
  return (
    <div className="space-y-4">
      {/* 1. License & Identity Hero Card */}
      <div className="rounded-xl border border-zinc-800 bg-gradient-to-r from-zinc-950 via-zinc-900/60 to-zinc-950 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted">Current License</div>
            <div className="mt-1 flex items-center gap-2">
              <span
                className={`rounded-full border px-3 py-1 font-mono text-[12px] font-bold uppercase tracking-wider ${
                  license.tier === 'admin'
                    ? 'border-purple-500/60 bg-purple-950/50 text-purple-300'
                    : license.tier === 'pro'
                    ? 'border-sky-500/60 bg-sky-950/50 text-sky-300'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-300'
                }`}
              >
                {license.label} ({license.tier})
              </span>
              {license.features.showWatermark ? (
                <span className="font-mono text-[11px] text-amber-400">Free watermark active</span>
              ) : (
                <span className="font-mono text-[11px] text-emerald-400">✓ Full unrestricted access</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-ghost h-7 px-2.5 text-[10px]"
              onClick={() => {
                persistLicense(LICENSE_TEST_KEYS.free);
                setLicenseMsg('Forced Free (ABLIT-FREE) to test gates. Paste your license key below to restore.');
              }}
            >
              Test Free Gates
            </button>
          </div>
        </div>

        <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[11px] text-zinc-400 border-t border-zinc-800/80 pt-3">
          <li>
            • MCP Servers: <strong className="text-zinc-200">{Number.isFinite(license.features.maxMcpServers) ? license.features.maxMcpServers : 'Unlimited'}</strong> (Enabled: {enabledMcp})
          </li>
          <li>
            • Parallel Jobs: <strong className="text-zinc-200">{Number.isFinite(license.features.maxConcurrentJobs) ? license.features.maxConcurrentJobs : 'Unlimited'}</strong>
          </li>
          <li>
            • Plan Mode: <strong className="text-zinc-200">{license.features.planModeAllowed ? 'Unlocked' : 'Locked'}</strong>
          </li>
          <li>
            • Built-in Token Allocation:{' '}
            <strong className="text-zinc-200">
              {license.features.maxIncludedTokens === 0
                ? 'BYOK (Featherless / Local)'
                : `${formatTokenCount(license.features.maxIncludedTokens)} tokens/mo`}
            </strong>
          </li>
        </ul>

        {license.features.maxIncludedTokens > 0 ? (
          <BuiltinTokenMeter license={license} settings={settings} />
        ) : null}
      </div>

      {/* 2. License Key & Access Code */}
      <Section
        title="License Key & Access Code"
        hint="Paste your ABLIT-* license key or redeem a one-time device-bound access code."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel label="License Key" hint="From checkout or signup email.">
              <input
                value={licenseDraft}
                onChange={(e) => setLicenseDraft(e.target.value)}
                placeholder="ABLIT-ADMIN / ABLIT-PRO-XXXX"
                className="field font-mono text-[12px]"
                spellCheck={false}
                autoComplete="off"
              />
            </FieldLabel>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="btn-primary h-7 px-3 text-[11px]"
                onClick={() => {
                  const key = normalizeLicenseKey(licenseDraft);
                  const next = persistLicense(key);
                  setLicenseMsg(
                    key
                      ? `Activated ${next.label}${next.isFree && key ? ' (unrecognized key → Free)' : ''}.`
                      : 'Cleared — Free tier.',
                  );
                }}
              >
                Activate Key
              </button>
            </div>
          </div>

          <div>
            <FieldLabel label="Redeem Access Code" hint="One-time promo code bound to deviceId.">
              <input
                value={redeemCode}
                onChange={(e) => setRedeemCode(e.target.value)}
                placeholder="ACCESS-…"
                className="field font-mono text-[12px]"
                spellCheck={false}
                autoComplete="off"
              />
            </FieldLabel>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="btn-primary h-7 px-3 text-[11px]"
                disabled={redeemBusy}
                onClick={() => void startRedeem()}
              >
                {redeemBusy ? 'Redeeming…' : 'Redeem Code'}
              </button>
            </div>
          </div>
        </div>
        {licenseMsg ? <p className="font-mono text-[11px] text-sky-300">{licenseMsg}</p> : null}
      </Section>

      {/* 3. Subscriptions (Card & Solana) */}
      <Section
        title="Plan & Subscriptions"
        hint={`Starter $${PRICING_HINT.starterMonthly}/mo · Pro $${PRICING_HINT.proMonthly}/mo or $${PRICING_HINT.proYearly}/yr · Team $${PRICING_HINT.teamMonthlySeat}/mo seat.`}
      >
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <FieldLabel label="Billing Email" hint="Receipt email for card & Solana payments.">
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

          <FieldLabel label="Plan" hint="Card or Solana USDC checkout.">
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
        </div>

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

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary h-7 px-3 text-[11px]"
            disabled={planBusy === 'stripe'}
            onClick={() => void startStripeCheckout()}
          >
            {planBusy === 'stripe' ? 'Opening Card Checkout…' : 'Pay with Card (Stripe)'}
          </button>
          <button
            type="button"
            className="btn-primary h-7 px-3 text-[11px]"
            disabled={planBusy === 'solana'}
            onClick={() => void startSolanaCheckout()}
          >
            {planBusy === 'solana' ? 'Generating Solana Link…' : 'Pay with Solana USDC'}
          </button>
          <button
            type="button"
            className="btn-ghost h-7 px-3 text-[11px]"
            disabled={cardsBusy === 'portal'}
            onClick={() => void startCustomerPortal()}
          >
            {cardsBusy === 'portal' ? 'Opening…' : 'Manage Subscription (Portal)'}
          </button>
          <button
            type="button"
            className="btn-ghost h-7 px-3 text-[11px]"
            disabled={cardsBusy === 'setup'}
            onClick={() => void startSaveCard()}
          >
            {cardsBusy === 'setup' ? 'Opening…' : 'Save a Card'}
          </button>
        </div>

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

        {solanaPayUrl ? (
          <div className="mt-3 rounded border border-border bg-background px-3 py-2 font-mono text-[11px] text-zinc-200">
            <div className="text-[10px] uppercase text-muted">
              Solana pay link{solanaAmount ? ` · ${solanaAmount} USDC` : ''}
            </div>
            <div className="mt-1 break-all text-sky-300">{solanaPayUrl}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-ghost h-7 px-2 text-[10px]"
                onClick={() => void openBillingUrl(solanaPayUrl)}
              >
                Open in Wallet
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
        {cardsMsg ? <p className="font-mono text-[11px] text-sky-300">{cardsMsg}</p> : null}
      </Section>

      {/* 4. Prepaid Crypto Credit Packs */}
      <Section
        title="Prepaid Crypto Credit Packs"
        hint="Prepaid model-credit packs via crypto (USDC on Solana, ETH, BTC, etc.). No auto-renew."
      >
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <FieldLabel label="Credit Pack" hint="5M / 20M / 50M credits.">
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

          <FieldLabel label="Cryptocurrency Asset" hint="Default Solana USDC.">
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
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary h-7 px-3 text-[11px]"
            disabled={cryptoBusy === 'create' || cryptoBusy === 'poll'}
            onClick={() => void startCryptoCheckout()}
          >
            {cryptoBusy === 'create'
              ? 'Creating Invoice…'
              : cryptoBusy === 'poll'
              ? 'Waiting for Confirmation…'
              : 'Pay with Crypto'}
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
              Resume Crypto Poll
            </button>
          ) : null}
          <button
            type="button"
            className="btn-ghost h-7 px-2 text-[10px]"
            disabled={cryptoBusy === 'load'}
            onClick={() => void loadCryptoCatalog()}
          >
            {cryptoBusy === 'load' ? 'Loading…' : 'Refresh Packs'}
          </button>
        </div>

        {cryptoPayUrl || cryptoPayUri ? (
          <div className="mt-3 rounded border border-border bg-background px-3 py-2 font-mono text-[11px] text-zinc-200">
            <div className="text-[10px] uppercase text-muted">
              Crypto Invoice{cryptoAmountLabel ? ` · ${cryptoAmountLabel}` : ''}
            </div>
            {cryptoPayUrl ? (
              <div className="mt-1 break-all text-sky-300">{cryptoPayUrl}</div>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {cryptoPayUrl ? (
                <button
                  type="button"
                  className="btn-ghost h-7 px-2 text-[10px]"
                  onClick={() => void openBillingUrl(cryptoPayUrl)}
                >
                  Open Checkout
                </button>
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
          </div>
        ) : null}

        {cryptoMsg ? <p className="font-mono text-[11px] text-sky-300">{cryptoMsg}</p> : null}
      </Section>
    </div>
  );
}
