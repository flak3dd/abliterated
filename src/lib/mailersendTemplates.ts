/**
 * Official Abliterated transactional email templates.
 * Matches abliterated-site templates:
 * 1. signup_welcome: "Welcome to Abliterated"
 * 2. payment_receipt: "Your Abliterated payment receipt"
 * 3. code_redeemed: "Your Abliterated license & login"
 */

export const EMAIL_LINKS = {
  home: "https://abliterated.app/",
  download: "https://abliterated.app/download",
  pricing: "https://abliterated.app/pricing",
  redeem: "https://abliterated.app/redeem",
  docs: "https://abliterated.app/docs",
  billing: "https://abliterated.app/account/billing",
  support: "mailto:info@abliterated.app",
} as const;

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function textLinkFooter(): string {
  return [
    "Links:",
    `Download: ${EMAIL_LINKS.download}`,
    `Activate / pricing: ${EMAIL_LINKS.pricing}`,
    `Redeem a code: ${EMAIL_LINKS.redeem}`,
    `Docs: ${EMAIL_LINKS.docs}`,
    `Manage billing: ${EMAIL_LINKS.billing}`,
    `Support: info@abliterated.app`,
  ].join("\n");
}

export function htmlLinkFooter(): string {
  return `<p style="margin-top:24px;font-size:13px;line-height:1.6;color:#64748b;border-top:1px solid #334155;padding-top:16px;">
<a href="${EMAIL_LINKS.download}" style="color:#38bdf8;">Download</a>
 · <a href="${EMAIL_LINKS.pricing}" style="color:#38bdf8;">Pricing</a>
 · <a href="${EMAIL_LINKS.redeem}" style="color:#38bdf8;">Redeem code</a>
 · <a href="${EMAIL_LINKS.docs}" style="color:#38bdf8;">Docs</a>
 · <a href="${EMAIL_LINKS.billing}" style="color:#38bdf8;">Manage billing</a>
 · <a href="${EMAIL_LINKS.support}" style="color:#38bdf8;">info@abliterated.app</a>
</p>`;
}

// 1. Signup Welcome
export const SIGNUP_WELCOME_SUBJECT = "Welcome to Abliterated";

export function signupWelcomeText(payload: Record<string, unknown>): string {
  return [
    "Welcome to Abliterated.",
    "",
    payload.loginId ? `Login ID: ${payload.loginId}` : "",
    payload.note
      ? String(payload.note)
      : "Create a paid plan or redeem a code to unlock a license.",
    "",
    `Download the app: ${EMAIL_LINKS.download}`,
    `See plans: ${EMAIL_LINKS.pricing}`,
    `Redeem a code: ${EMAIL_LINKS.redeem}`,
    "",
    textLinkFooter(),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function signupWelcomeHtml(payload: Record<string, unknown>): string {
  const loginId = payload.loginId ? String(payload.loginId) : "";
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:580px;margin:0 auto;padding:24px;background:#0f172a;color:#f8fafc;border-radius:8px;border:1px solid #334155;">
<h2 style="color:#38bdf8;margin-top:0;">Welcome to Abliterated</h2>
<p style="font-size:15px;line-height:1.6;color:#cbd5e1;">Welcome to Abliterated — the uncensored local agent IDE with built-in model inference, local bridge, and persistent memory.</p>
${loginId ? `<div style="background:#1e293b;padding:12px 16px;border-radius:6px;border:1px solid #475569;margin:16px 0;"><span style="color:#94a3b8;font-size:12px;text-transform:uppercase;">Login ID:</span><br/><strong style="font-family:monospace;font-size:16px;color:#38bdf8;">${esc(loginId)}</strong></div>` : ""}
<p style="font-size:14px;color:#cbd5e1;">Download the desktop app, then sign in under <strong>Settings → Account</strong>. A paid plan or access code unlocks a license.</p>
<div style="margin:20px 0;">
  <a href="${EMAIL_LINKS.download}" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px;">Download Desktop App</a>
</div>
${htmlLinkFooter()}
</div>`;
}

// 2. Payment Receipt
export const PAYMENT_RECEIPT_SUBJECT = "Your Abliterated payment receipt";

export function paymentReceiptText(payload: Record<string, unknown>): string {
  return [
    "Abliterated payment receipt",
    "",
    `Plan: ${payload.plan ?? ""}`,
    payload.seats != null ? `Seats: ${payload.seats}` : "",
    payload.licenseKey ? `License key: ${payload.licenseKey}` : "",
    payload.tokens ? `Monthly tokens: ${Number(payload.tokens).toLocaleString()}` : "",
    payload.sessionId ? `Stripe session: ${payload.sessionId}` : "",
    payload.invoiceId ? `Invoice: ${payload.invoiceId}` : "",
    payload.provider ? `Provider: ${payload.provider}` : "",
    "",
    "Activate in the desktop app: Settings → License.",
    `Download: ${EMAIL_LINKS.download}`,
    `Manage billing: ${EMAIL_LINKS.billing}`,
    "",
    textLinkFooter(),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function paymentReceiptHtml(payload: Record<string, unknown>): string {
  const license = payload.licenseKey ? String(payload.licenseKey) : "";
  const plan = payload.plan ? String(payload.plan) : "";
  const tokens = payload.tokens ? Number(payload.tokens).toLocaleString() : "";
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:580px;margin:0 auto;padding:24px;background:#0f172a;color:#f8fafc;border-radius:8px;border:1px solid #334155;">
<h2 style="color:#4ade80;margin-top:0;">Payment Confirmed</h2>
<p style="font-size:15px;line-height:1.6;color:#cbd5e1;">Thanks for your Abliterated purchase. Your subscription is active.</p>
<div style="background:#1e293b;padding:16px;border-radius:6px;border:1px solid #475569;margin:16px 0;font-size:14px;line-height:1.8;">
  <div><span style="color:#94a3b8;">Plan:</span> <strong style="color:#f8fafc;text-transform:uppercase;">${esc(plan)}</strong></div>
  ${tokens ? `<div><span style="color:#94a3b8;">Token Allowance:</span> <strong style="color:#38bdf8;">${tokens} tokens / month</strong></div>` : ""}
  ${license ? `<div style="margin-top:8px;"><span style="color:#94a3b8;">License Key:</span><br/><code style="display:inline-block;background:#0f172a;padding:6px 10px;border-radius:4px;font-family:monospace;font-size:15px;color:#4ade80;border:1px solid #334155;margin-top:4px;">${esc(license)}</code></div>` : ""}
</div>
<p style="font-size:14px;color:#cbd5e1;">To activate your features, paste your license key in the desktop app under <strong>Settings → License</strong>.</p>
<div style="margin:20px 0;">
  <a href="${EMAIL_LINKS.download}" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px;">Launch Abliterated</a>
</div>
${htmlLinkFooter()}
</div>`;
}

// 3. Code Redeemed
export const CODE_REDEEMED_SUBJECT = "Your Abliterated license & login";

export function codeRedeemedText(payload: Record<string, unknown>): string {
  return [
    "Your Abliterated access code is redeemed.",
    "",
    payload.plan ? `Plan: ${payload.plan}` : "",
    payload.tier ? `Tier: ${payload.tier}` : "",
    payload.licenseKey ? `License key: ${payload.licenseKey}` : "",
    payload.loginId ? `Login ID: ${payload.loginId}` : "",
    payload.inferenceKey ? `Platform / LiteLLM API key: ${payload.inferenceKey}` : "",
    payload.inferenceBaseUrl ? `Gateway URL: ${payload.inferenceBaseUrl}` : "",
    "",
    "Paste the license key in the desktop app: Settings → License.",
    payload.inferenceKey
      ? "Paste the Platform / LiteLLM key on API → Platform (or Token). Do not share it."
      : "",
    `Download: ${EMAIL_LINKS.download}`,
    `Docs: ${EMAIL_LINKS.docs}`,
    "",
    textLinkFooter(),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function codeRedeemedHtml(payload: Record<string, unknown>): string {
  const license = payload.licenseKey ? String(payload.licenseKey) : "";
  const loginId = payload.loginId ? String(payload.loginId) : "";
  const inference = payload.inferenceKey ? String(payload.inferenceKey) : "";
  const base = payload.inferenceBaseUrl ? String(payload.inferenceBaseUrl) : "";
  const plan = payload.plan ? String(payload.plan) : "";
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:580px;margin:0 auto;padding:24px;background:#0f172a;color:#f8fafc;border-radius:8px;border:1px solid #334155;">
<h2 style="color:#a855f7;margin-top:0;">Access Code Redeemed</h2>
<p style="font-size:15px;line-height:1.6;color:#cbd5e1;">Your Abliterated access code was successfully redeemed and bound to your device.</p>
<div style="background:#1e293b;padding:16px;border-radius:6px;border:1px solid #475569;margin:16px 0;font-size:14px;line-height:1.8;">
  ${plan ? `<div><span style="color:#94a3b8;">Plan:</span> <strong style="color:#f8fafc;text-transform:uppercase;">${esc(plan)}</strong></div>` : ""}
  ${license ? `<div style="margin-top:8px;"><span style="color:#94a3b8;">License Key:</span><br/><code style="display:inline-block;background:#0f172a;padding:6px 10px;border-radius:4px;font-family:monospace;font-size:15px;color:#4ade80;border:1px solid #334155;margin-top:4px;">${esc(license)}</code></div>` : ""}
  ${loginId ? `<div style="margin-top:8px;"><span style="color:#94a3b8;">Login ID:</span><br/><code style="display:inline-block;background:#0f172a;padding:6px 10px;border-radius:4px;font-family:monospace;font-size:14px;color:#38bdf8;border:1px solid #334155;margin-top:4px;">${esc(loginId)}</code></div>` : ""}
  ${inference ? `<div style="margin-top:8px;"><span style="color:#94a3b8;">Inference API Key:</span><br/><code style="display:inline-block;background:#0f172a;padding:6px 10px;border-radius:4px;font-family:monospace;font-size:13px;color:#f59e0b;border:1px solid #334155;margin-top:4px;">${esc(inference)}</code></div>` : ""}
  ${base ? `<div><span style="color:#94a3b8;">Gateway URL:</span> <span style="font-family:monospace;color:#cbd5e1;">${esc(base)}</span></div>` : ""}
</div>
<p style="font-size:13px;color:#94a3b8;">Paste the license key in <strong>Settings → License</strong>. Paste the inference key in <strong>API → Platform</strong>.</p>
${htmlLinkFooter()}
</div>`;
}

export interface AbliteratedTemplateDefinition {
  type: "signup_welcome" | "payment_receipt" | "code_redeemed";
  name: string;
  subject: string;
  defaultPayload: Record<string, unknown>;
  getText: (payload: Record<string, unknown>) => string;
  getHtml: (payload: Record<string, unknown>) => string;
}

export const ABLITERATED_TEMPLATES: AbliteratedTemplateDefinition[] = [
  {
    type: "signup_welcome",
    name: "Signup Welcome",
    subject: SIGNUP_WELCOME_SUBJECT,
    defaultPayload: {
      loginId: "ABLIT-LOGIN-TEST0001",
      deviceId: "dev_test_browser",
      source: "signup",
      note: "TEST: Free account created. Purchase or redeem a code to unlock a paid license.",
    },
    getText: signupWelcomeText,
    getHtml: signupWelcomeHtml,
  },
  {
    type: "payment_receipt",
    name: "Payment Receipt",
    subject: PAYMENT_RECEIPT_SUBJECT,
    defaultPayload: {
      provider: "stripe",
      plan: "pro_monthly",
      seats: 1,
      licenseKey: "ABLIT-PRO-TEST-0001",
      sessionId: "cs_test_email_template",
      subscription: true,
      savedCard: true,
      tokens: 3_000_000,
    },
    getText: paymentReceiptText,
    getHtml: paymentReceiptHtml,
  },
  {
    type: "code_redeemed",
    name: "Code Redeemed",
    subject: CODE_REDEEMED_SUBJECT,
    defaultPayload: {
      plan: "pro_monthly",
      tier: "pro",
      licenseKey: "ABLIT-PRO-TEST-0001",
      loginId: "ABLIT-LOGIN-TEST0001",
      inferenceKey: "sk-test-litellm-not-a-real-key",
      inferenceBaseUrl: "https://abliterated.app/api/v1",
      note: "TEST: Paste the license key in Settings → License. Paste the Platform / LiteLLM key on API → Platform.",
    },
    getText: codeRedeemedText,
    getHtml: codeRedeemedHtml,
  },
];
