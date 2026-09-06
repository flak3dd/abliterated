/**
 * In-app billing client for abliterated.app checkout APIs.
 * Stripe secrets stay on the site — this module only calls public HTTPS endpoints.
 */

export const DEFAULT_BILLING_SITE = 'https://abliterated.app';

export type BillingPlan =
  | 'starter_monthly'
  | 'pro_monthly'
  | 'pro_yearly'
  | 'team_monthly';

export const BILLING_PLANS: readonly BillingPlan[] = [
  'starter_monthly',
  'pro_monthly',
  'pro_yearly',
  'team_monthly',
] as const;

export const BILLING_PLAN_LABELS: Record<BillingPlan, string> = {
  starter_monthly: 'Starter — monthly',
  pro_monthly: 'Pro — monthly',
  pro_yearly: 'Pro — yearly',
  team_monthly: 'Team — monthly (per seat)',
};

export type BillingSiteSettings = {
  billingSiteUrl?: string;
};

export class BillingApiError extends Error {
  status: number;
  detail?: string;
  constructor(message: string, status = 0, detail?: string) {
    super(message);
    this.name = 'BillingApiError';
    this.status = status;
    this.detail = detail;
  }
}

/** Normalize site origin (no trailing slash). */
export function billingSiteBase(
  settingsOrUrl?: BillingSiteSettings | string | null,
): string {
  const raw =
    typeof settingsOrUrl === 'string'
      ? settingsOrUrl
      : settingsOrUrl?.billingSiteUrl;
  const trimmed = String(raw || '').trim().replace(/\/+$/, '');
  return trimmed || DEFAULT_BILLING_SITE;
}

/** Join site base + API path. */
export function billingApiUrl(
  settingsOrUrl: BillingSiteSettings | string | null | undefined,
  path: string,
): string {
  const base = billingSiteBase(settingsOrUrl);
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

/** Pull cs_… session id from a Stripe Checkout URL (or any string containing it). */
export function extractStripeSessionId(urlOrText: string): string | null {
  const m = String(urlOrText || '').match(/\b(cs_(?:test_|live_)?[A-Za-z0-9]+)\b/);
  return m?.[1] ?? null;
}

/**
 * Parse abliterated://license?key=… deep links.
 * Accepts hostname or path form: abliterated://license?key=… / abliterated:license?key=…
 */
export function parseLicenseDeepLink(url: string): string | null {
  const raw = String(url || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'abliterated:') return null;
    const host = (u.hostname || '').toLowerCase();
    const pathPart = (u.pathname || '').replace(/^\/+/, '').toLowerCase();
    // abliterated://license?key=…  → hostname "license"
    // abliterated:/license?key=…   → pathname "license"
    const isLicense = host === 'license' || pathPart === 'license';
    if (!isLicense) return null;
    const key = (u.searchParams.get('key') || '').trim();
    return key || null;
  } catch {
    return null;
  }
}

export type StripeCheckoutRequest = {
  plan: BillingPlan;
  seats?: number;
  email: string;
  client_reference_id?: string;
};

export type StripeCheckoutResponse = {
  url: string;
  customerId?: string;
  mode?: string;
};

export type CheckoutSessionResponse = {
  session_id: string;
  status: string | null;
  payment_status: string | null;
  plan: string | null;
  seats: number | null;
  email: string | null;
  license: {
    key: string;
    prefix?: string;
    signed?: boolean;
    plan?: string;
  } | null;
};

export type SolanaPaymentCreateRequest = {
  plan: BillingPlan;
  seats?: number;
  email?: string;
};

export type SolanaPaymentCreateResponse = {
  paymentId: string;
  amountUsdc: string;
  recipient: string;
  reference: string;
  url: string;
  label: string;
  message: string;
  cluster: string;
  usdcMint: string;
};

export type SolanaPaymentStatusResponse = {
  paymentId: string;
  status: string;
  plan: string;
  seats: number;
  amountUsdc: string;
  recipient: string;
  reference: string;
  url: string;
  label: string;
  message: string;
  createdAt?: string;
  expiresAt?: string;
  confirmedAt?: string | null;
  signature?: string | null;
  licenseKey?: string | null;
  licenseExpiresAt?: string | null;
};

export type SolanaConfirmRequest = {
  paymentId: string;
  signature?: string;
  email?: string;
};

export type SolanaConfirmResponse = {
  paymentId: string;
  status: string;
  licenseKey?: string;
  licenseExpiresAt?: string;
  signature?: string;
  note?: string;
  redirectUrl?: string;
  plan?: string;
  seats?: number;
  error?: string;
};

export type RedeemRequest = {
  code: string;
  email: string;
  deviceId: string;
};

export type RedeemResponse = {
  licenseKey: string;
  loginId: string;
  tier?: string;
  plan?: string;
  email?: string;
  deviceId?: string;
  deviceBound?: boolean;
  note?: string;
};

type JsonRecord = Record<string, unknown>;

async function readJson(res: Response): Promise<JsonRecord> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as JsonRecord;
  } catch {
    throw new BillingApiError('Invalid JSON from billing API', res.status, text.slice(0, 200));
  }
}

function errorFromBody(body: JsonRecord, fallback: string, status: number): BillingApiError {
  const err = typeof body.error === 'string' ? body.error : fallback;
  const detail = typeof body.detail === 'string' ? body.detail : undefined;
  return new BillingApiError(detail ? `${err}: ${detail}` : err, status, detail);
}

export async function createStripeCheckout(
  settingsOrUrl: BillingSiteSettings | string | null | undefined,
  body: StripeCheckoutRequest,
): Promise<StripeCheckoutResponse> {
  const url = billingApiUrl(settingsOrUrl, '/api/checkout');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      plan: body.plan,
      email: body.email,
      seats: body.seats,
      client_reference_id: body.client_reference_id,
    }),
  });
  const json = await readJson(res);
  if (!res.ok) throw errorFromBody(json, 'Checkout failed', res.status);
  const checkoutUrl = typeof json.url === 'string' ? json.url : '';
  if (!checkoutUrl) throw new BillingApiError('Checkout response missing url', res.status);
  return {
    url: checkoutUrl,
    customerId: typeof json.customerId === 'string' ? json.customerId : undefined,
    mode: typeof json.mode === 'string' ? json.mode : undefined,
  };
}

export async function getCheckoutSession(
  settingsOrUrl: BillingSiteSettings | string | null | undefined,
  sessionId: string,
): Promise<CheckoutSessionResponse> {
  const id = String(sessionId || '').trim();
  if (!id.startsWith('cs_')) {
    throw new BillingApiError('session_id must start with cs_', 400);
  }
  const url = billingApiUrl(
    settingsOrUrl,
    `/api/checkout/session?session_id=${encodeURIComponent(id)}`,
  );
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const json = await readJson(res);
  if (!res.ok) throw errorFromBody(json, 'Session lookup failed', res.status);
  const licenseRaw = json.license;
  let license: CheckoutSessionResponse['license'] = null;
  if (licenseRaw && typeof licenseRaw === 'object' && !Array.isArray(licenseRaw)) {
    const L = licenseRaw as JsonRecord;
    if (typeof L.key === 'string' && L.key) {
      license = {
        key: L.key,
        prefix: typeof L.prefix === 'string' ? L.prefix : undefined,
        signed: typeof L.signed === 'boolean' ? L.signed : undefined,
        plan: typeof L.plan === 'string' ? L.plan : undefined,
      };
    }
  }
  return {
    session_id: typeof json.session_id === 'string' ? json.session_id : id,
    status: typeof json.status === 'string' ? json.status : null,
    payment_status: typeof json.payment_status === 'string' ? json.payment_status : null,
    plan: typeof json.plan === 'string' ? json.plan : null,
    seats: typeof json.seats === 'number' ? json.seats : null,
    email: typeof json.email === 'string' ? json.email : null,
    license,
  };
}

export async function createSolanaPayment(
  settingsOrUrl: BillingSiteSettings | string | null | undefined,
  body: SolanaPaymentCreateRequest,
): Promise<SolanaPaymentCreateResponse> {
  const url = billingApiUrl(settingsOrUrl, '/api/checkout/solana');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      plan: body.plan,
      seats: body.seats,
      email: body.email,
    }),
  });
  const json = await readJson(res);
  if (!res.ok) throw errorFromBody(json, 'Solana checkout failed', res.status);
  const paymentId = typeof json.paymentId === 'string' ? json.paymentId : '';
  const payUrl = typeof json.url === 'string' ? json.url : '';
  if (!paymentId || !payUrl) {
    throw new BillingApiError('Solana response missing paymentId/url', res.status);
  }
  return {
    paymentId,
    amountUsdc: String(json.amountUsdc ?? ''),
    recipient: String(json.recipient ?? ''),
    reference: String(json.reference ?? ''),
    url: payUrl,
    label: String(json.label ?? ''),
    message: String(json.message ?? ''),
    cluster: String(json.cluster ?? ''),
    usdcMint: String(json.usdcMint ?? ''),
  };
}

export async function getSolanaPayment(
  settingsOrUrl: BillingSiteSettings | string | null | undefined,
  paymentId: string,
): Promise<SolanaPaymentStatusResponse> {
  const id = String(paymentId || '').trim();
  if (!id) throw new BillingApiError('paymentId required', 400);
  const url = billingApiUrl(
    settingsOrUrl,
    `/api/checkout/solana?paymentId=${encodeURIComponent(id)}`,
  );
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const json = await readJson(res);
  if (!res.ok) throw errorFromBody(json, 'Solana payment lookup failed', res.status);
  return {
    paymentId: typeof json.paymentId === 'string' ? json.paymentId : id,
    status: String(json.status ?? ''),
    plan: String(json.plan ?? ''),
    seats: typeof json.seats === 'number' ? json.seats : 1,
    amountUsdc: String(json.amountUsdc ?? ''),
    recipient: String(json.recipient ?? ''),
    reference: String(json.reference ?? ''),
    url: String(json.url ?? ''),
    label: String(json.label ?? ''),
    message: String(json.message ?? ''),
    createdAt: typeof json.createdAt === 'string' ? json.createdAt : undefined,
    expiresAt: typeof json.expiresAt === 'string' ? json.expiresAt : undefined,
    confirmedAt: typeof json.confirmedAt === 'string' ? json.confirmedAt : null,
    signature: typeof json.signature === 'string' ? json.signature : null,
    licenseKey: typeof json.licenseKey === 'string' ? json.licenseKey : null,
    licenseExpiresAt:
      typeof json.licenseExpiresAt === 'string' ? json.licenseExpiresAt : null,
  };
}

export async function confirmSolanaPayment(
  settingsOrUrl: BillingSiteSettings | string | null | undefined,
  body: SolanaConfirmRequest,
): Promise<SolanaConfirmResponse> {
  const url = billingApiUrl(settingsOrUrl, '/api/checkout/solana/confirm');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      paymentId: body.paymentId,
      signature: body.signature,
      email: body.email,
    }),
  });
  const json = await readJson(res);
  if (!res.ok) throw errorFromBody(json, 'Solana confirm failed', res.status);
  return {
    paymentId: typeof json.paymentId === 'string' ? json.paymentId : body.paymentId,
    status: String(json.status ?? ''),
    licenseKey: typeof json.licenseKey === 'string' ? json.licenseKey : undefined,
    licenseExpiresAt:
      typeof json.licenseExpiresAt === 'string' ? json.licenseExpiresAt : undefined,
    signature: typeof json.signature === 'string' ? json.signature : undefined,
    note: typeof json.note === 'string' ? json.note : undefined,
    redirectUrl: typeof json.redirectUrl === 'string' ? json.redirectUrl : undefined,
    plan: typeof json.plan === 'string' ? json.plan : undefined,
    seats: typeof json.seats === 'number' ? json.seats : undefined,
  };
}

export async function redeemAccessCode(
  settingsOrUrl: BillingSiteSettings | string | null | undefined,
  body: RedeemRequest,
): Promise<RedeemResponse> {
  const url = billingApiUrl(settingsOrUrl, '/api/redeem');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      code: body.code,
      email: body.email,
      deviceId: body.deviceId,
    }),
  });
  const json = await readJson(res);
  if (!res.ok) throw errorFromBody(json, 'Redeem failed', res.status);
  const licenseKey = typeof json.licenseKey === 'string' ? json.licenseKey : '';
  if (!licenseKey) throw new BillingApiError('Redeem response missing licenseKey', res.status);
  return {
    licenseKey,
    loginId: typeof json.loginId === 'string' ? json.loginId : '',
    tier: typeof json.tier === 'string' ? json.tier : undefined,
    plan: typeof json.plan === 'string' ? json.plan : undefined,
    email: typeof json.email === 'string' ? json.email : undefined,
    deviceId: typeof json.deviceId === 'string' ? json.deviceId : undefined,
    deviceBound: json.deviceBound === true,
    note: typeof json.note === 'string' ? json.note : undefined,
  };
}


export type CreditPackId = 'credits_5m' | 'credits_20m' | 'credits_50m';

export type CreditPack = {
  id: CreditPackId;
  label: string;
  tokens: number;
  usd: number;
  blurb: string;
};

/** Static fallback when GET /api/checkout/crypto is unreachable. */
export const FALLBACK_CREDIT_PACKS: readonly CreditPack[] = [
  {
    id: 'credits_5m',
    label: '5M app credits',
    tokens: 5_000_000,
    usd: 25,
    blurb: 'Top-up tokens for the inbuilt abliteration.ai API — one-time crypto purchase.',
  },
  {
    id: 'credits_20m',
    label: '20M app credits',
    tokens: 20_000_000,
    usd: 79,
    blurb: 'Best value top-up for heavier agent runs. Crypto only; does not renew.',
  },
  {
    id: 'credits_50m',
    label: '50M app credits',
    tokens: 50_000_000,
    usd: 169,
    blurb: 'Large credit pack for teams and long Jobs. Prepaid via crypto.',
  },
] as const;

export type CryptoAssetMeta = {
  id: string;
  label: string;
  network: string;
  symbol: string;
  live: boolean;
};

export type CryptoCheckoutMeta = {
  facilitator: string;
  product: string;
  packs: CreditPack[];
  assets: CryptoAssetMeta[];
};

export type CryptoInvoiceView = {
  invoiceId: string;
  facilitator?: string;
  status: string;
  product?: string;
  creditPackId?: string;
  creditPackLabel?: string;
  creditsTokens?: number;
  plan?: string | null;
  planLabel?: string;
  seats?: number | null;
  asset?: string;
  assetLabel?: string;
  symbol?: string;
  network?: string;
  address?: string;
  contract?: string | null;
  amountUsd?: number | string;
  amountCrypto?: string;
  /** Wallet payment URI (solana:, bitcoin:, etc.). */
  uri?: string;
  /** Site checkout page for this invoice (open in browser). */
  url: string;
  expiresAt?: string;
  licenseKey?: string | null;
  licenseExpiresAt?: string | null;
  creditsLedgerId?: string | null;
  txid?: string | null;
  licenseWindowDays?: number;
  listUsd?: number;
  note?: string;
};

export type CryptoConfirmResponse = {
  invoiceId: string;
  status: string;
  product?: string;
  creditPackId?: string;
  creditsTokens?: number;
  creditsLedgerId?: string;
  licenseKey?: string;
  licenseExpiresAt?: string;
  txid?: string;
  plan?: string;
  seats?: number;
  asset?: string;
  redirectUrl?: string;
  licenseWindowDays?: number;
  note?: string;
  error?: string;
};

function parseCreditPack(raw: unknown): CreditPack | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as JsonRecord;
  const id = typeof p.id === 'string' ? p.id : '';
  if (id !== 'credits_5m' && id !== 'credits_20m' && id !== 'credits_50m') return null;
  return {
    id,
    label: typeof p.label === 'string' ? p.label : id,
    tokens: typeof p.tokens === 'number' ? p.tokens : 0,
    usd: typeof p.usd === 'number' ? p.usd : 0,
    blurb: typeof p.blurb === 'string' ? p.blurb : '',
  };
}

function cryptoInvoicePageUrl(
  settingsOrUrl: BillingSiteSettings | string | null | undefined,
  invoiceId: string,
): string {
  return billingApiUrl(
    settingsOrUrl,
    `/checkout/crypto?invoiceId=${encodeURIComponent(invoiceId)}`,
  );
}

function parseCryptoInvoiceView(
  settingsOrUrl: BillingSiteSettings | string | null | undefined,
  json: JsonRecord,
  fallbackId?: string,
): CryptoInvoiceView {
  const invoiceId =
    typeof json.invoiceId === 'string' && json.invoiceId
      ? json.invoiceId
      : String(fallbackId || '');
  if (!invoiceId) {
    throw new BillingApiError('Crypto response missing invoiceId', 502);
  }
  return {
    invoiceId,
    facilitator: typeof json.facilitator === 'string' ? json.facilitator : undefined,
    status: String(json.status ?? ''),
    product: typeof json.product === 'string' ? json.product : undefined,
    creditPackId: typeof json.creditPackId === 'string' ? json.creditPackId : undefined,
    creditPackLabel: typeof json.creditPackLabel === 'string' ? json.creditPackLabel : undefined,
    creditsTokens: typeof json.creditsTokens === 'number' ? json.creditsTokens : undefined,
    plan: typeof json.plan === 'string' ? json.plan : null,
    planLabel: typeof json.planLabel === 'string' ? json.planLabel : undefined,
    seats: typeof json.seats === 'number' ? json.seats : null,
    asset: typeof json.asset === 'string' ? json.asset : undefined,
    assetLabel: typeof json.assetLabel === 'string' ? json.assetLabel : undefined,
    symbol: typeof json.symbol === 'string' ? json.symbol : undefined,
    network: typeof json.network === 'string' ? json.network : undefined,
    address: typeof json.address === 'string' ? json.address : undefined,
    contract: typeof json.contract === 'string' ? json.contract : null,
    amountUsd: typeof json.amountUsd === 'number' || typeof json.amountUsd === 'string' ? json.amountUsd : undefined,
    amountCrypto: typeof json.amountCrypto === 'string' ? json.amountCrypto : undefined,
    uri: typeof json.uri === 'string' ? json.uri : undefined,
    url: cryptoInvoicePageUrl(settingsOrUrl, invoiceId),
    expiresAt: typeof json.expiresAt === 'string' ? json.expiresAt : undefined,
    licenseKey: typeof json.licenseKey === 'string' ? json.licenseKey : null,
    licenseExpiresAt: typeof json.licenseExpiresAt === 'string' ? json.licenseExpiresAt : null,
    creditsLedgerId: typeof json.creditsLedgerId === 'string' ? json.creditsLedgerId : null,
    txid: typeof json.txid === 'string' ? json.txid : null,
    licenseWindowDays: typeof json.licenseWindowDays === 'number' ? json.licenseWindowDays : undefined,
    listUsd: typeof json.listUsd === 'number' ? json.listUsd : undefined,
    note: typeof json.note === 'string' ? json.note : undefined,
  };
}

export async function openCustomerPortal(
  settingsOrUrl: BillingSiteSettings | string | null | undefined,
  body: { email: string },
): Promise<{ url: string; customerId?: string }> {
  const url = billingApiUrl(settingsOrUrl, '/api/billing/portal');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: body.email }),
  });
  const json = await readJson(res);
  if (!res.ok) throw errorFromBody(json, 'Billing portal failed', res.status);
  const portalUrl = typeof json.url === 'string' ? json.url : '';
  if (!portalUrl) throw new BillingApiError('Portal response missing url', res.status);
  return {
    url: portalUrl,
    customerId: typeof json.customerId === 'string' ? json.customerId : undefined,
  };
}

export async function setupCard(
  settingsOrUrl: BillingSiteSettings | string | null | undefined,
  body: { email: string },
): Promise<{ url: string; customerId?: string }> {
  const url = billingApiUrl(settingsOrUrl, '/api/billing/setup-card');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: body.email }),
  });
  const json = await readJson(res);
  if (!res.ok) throw errorFromBody(json, 'Card setup failed', res.status);
  const setupUrl = typeof json.url === 'string' ? json.url : '';
  if (!setupUrl) throw new BillingApiError('Setup-card response missing url', res.status);
  return {
    url: setupUrl,
    customerId: typeof json.customerId === 'string' ? json.customerId : undefined,
  };
}

export async function listCryptoCheckout(
  settingsOrUrl: BillingSiteSettings | string | null | undefined,
): Promise<CryptoCheckoutMeta> {
  const url = billingApiUrl(settingsOrUrl, '/api/checkout/crypto');
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const json = await readJson(res);
  if (!res.ok) throw errorFromBody(json, 'Crypto catalog failed', res.status);
  const packsRaw = Array.isArray(json.packs) ? json.packs : [];
  const packs = packsRaw.map(parseCreditPack).filter((p): p is CreditPack => p != null);
  const assetsRaw = Array.isArray(json.assets) ? json.assets : [];
  const assets: CryptoAssetMeta[] = assetsRaw
    .map((a) => {
      if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
      const r = a as JsonRecord;
      if (typeof r.id !== 'string' || !r.id) return null;
      return {
        id: r.id,
        label: typeof r.label === 'string' ? r.label : r.id,
        network: typeof r.network === 'string' ? r.network : '',
        symbol: typeof r.symbol === 'string' ? r.symbol : '',
        live: r.live === true,
      };
    })
    .filter((a): a is CryptoAssetMeta => a != null);
  return {
    facilitator: typeof json.facilitator === 'string' ? json.facilitator : '',
    product: typeof json.product === 'string' ? json.product : 'credits',
    packs: packs.length ? packs : [...FALLBACK_CREDIT_PACKS],
    assets,
  };
}

export async function createCryptoInvoice(
  settingsOrUrl: BillingSiteSettings | string | null | undefined,
  body: { creditPackId: CreditPackId | string; email: string; asset?: string },
): Promise<CryptoInvoiceView> {
  const url = billingApiUrl(settingsOrUrl, '/api/checkout/crypto');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      creditPackId: body.creditPackId,
      email: body.email,
      asset: body.asset || 'usdc_sol',
    }),
  });
  const json = await readJson(res);
  if (!res.ok) throw errorFromBody(json, 'Crypto invoice failed', res.status);
  return parseCryptoInvoiceView(settingsOrUrl, json);
}

export async function getCryptoInvoice(
  settingsOrUrl: BillingSiteSettings | string | null | undefined,
  invoiceId: string,
): Promise<CryptoInvoiceView> {
  const id = String(invoiceId || '').trim();
  if (!id) throw new BillingApiError('invoiceId required', 400);
  const url = billingApiUrl(
    settingsOrUrl,
    `/api/checkout/crypto?invoiceId=${encodeURIComponent(id)}`,
  );
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const json = await readJson(res);
  if (!res.ok) throw errorFromBody(json, 'Crypto invoice lookup failed', res.status);
  return parseCryptoInvoiceView(settingsOrUrl, json, id);
}

export async function confirmCryptoInvoice(
  settingsOrUrl: BillingSiteSettings | string | null | undefined,
  body: { invoiceId: string; email?: string; txid?: string },
): Promise<CryptoConfirmResponse> {
  const url = billingApiUrl(settingsOrUrl, '/api/checkout/crypto/confirm');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      invoiceId: body.invoiceId,
      email: body.email,
      txid: body.txid,
    }),
  });
  const json = await readJson(res);
  if (!res.ok) throw errorFromBody(json, 'Crypto confirm failed', res.status);
  return {
    invoiceId: typeof json.invoiceId === 'string' ? json.invoiceId : body.invoiceId,
    status: String(json.status ?? ''),
    product: typeof json.product === 'string' ? json.product : undefined,
    creditPackId: typeof json.creditPackId === 'string' ? json.creditPackId : undefined,
    creditsTokens: typeof json.creditsTokens === 'number' ? json.creditsTokens : undefined,
    creditsLedgerId: typeof json.creditsLedgerId === 'string' ? json.creditsLedgerId : undefined,
    licenseKey: typeof json.licenseKey === 'string' ? json.licenseKey : undefined,
    licenseExpiresAt:
      typeof json.licenseExpiresAt === 'string' ? json.licenseExpiresAt : undefined,
    txid: typeof json.txid === 'string' ? json.txid : undefined,
    plan: typeof json.plan === 'string' ? json.plan : undefined,
    seats: typeof json.seats === 'number' ? json.seats : undefined,
    asset: typeof json.asset === 'string' ? json.asset : undefined,
    redirectUrl: typeof json.redirectUrl === 'string' ? json.redirectUrl : undefined,
    licenseWindowDays:
      typeof json.licenseWindowDays === 'number' ? json.licenseWindowDays : undefined,
    note: typeof json.note === 'string' ? json.note : undefined,
  };
}

const DEVICE_ID_KEY = 'ablit_device_id';

/**
 * Stable per-install device id for redeem / client_reference_id / auth.
 * Prefer an explicit id (e.g. settings.deviceId), then localStorage, else mint UUID.
 */
export function getOrCreateDeviceId(preferred?: string | null): string {
  const fromArg = typeof preferred === 'string' ? preferred.trim() : '';
  if (fromArg) {
    try {
      localStorage.setItem(DEVICE_ID_KEY, fromArg);
    } catch {
      /* ignore */
    }
    return fromArg;
  }
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY)?.trim();
    if (existing) return existing;
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return `dev-${Date.now().toString(36)}`;
  }
}

export async function openBillingUrl(url: string): Promise<boolean> {
  type DesktopBridge = { openExternal?: (u: string) => Promise<boolean> };
  const w = typeof globalThis !== 'undefined' ? (globalThis as { window?: Window & { ablitDesktop?: DesktopBridge } }).window : undefined;
  const desktop = w?.ablitDesktop;
  if (desktop?.openExternal) {
    try {
      return Boolean(await desktop.openExternal(url));
    } catch {
      /* fall through */
    }
  }
  try {
    if (w?.open) {
      w.open(url, '_blank', 'noopener,noreferrer');
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}
