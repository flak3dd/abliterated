#!/usr/bin/env node
/**
 * Unit smoke for billingApi URL/parse helpers — no network.
 * Run: node scripts/test-billing-api.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-billing-api');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

execFileSync(
  'node_modules/.bin/tsc',
  [
    'src/lib/billingApi.ts',
    '--outDir',
    outDir,
    '--module',
    'esnext',
    '--target',
    'es2022',
    '--moduleResolution',
    'bundler',
    '--strict',
    '--skipLibCheck',
  ],
  { cwd: root, stdio: 'inherit' },
);

const mod = await import(pathToFileURL(path.join(outDir, 'billingApi.js')).href);
const {
  DEFAULT_BILLING_SITE,
  BILLING_PLANS,
  FALLBACK_CREDIT_PACKS,
  billingSiteBase,
  billingApiUrl,
  extractStripeSessionId,
  parseLicenseDeepLink,
} = mod;

assert.equal(billingSiteBase(null), DEFAULT_BILLING_SITE);
assert.equal(billingSiteBase(undefined), DEFAULT_BILLING_SITE);
assert.equal(billingSiteBase(''), DEFAULT_BILLING_SITE);
assert.equal(billingSiteBase('https://abliterated.app/'), 'https://abliterated.app');
assert.equal(billingSiteBase({ billingSiteUrl: 'https://staging.example.com/' }), 'https://staging.example.com');
assert.equal(billingSiteBase('https://staging.example.com'), 'https://staging.example.com');

assert.equal(
  billingApiUrl(null, '/api/checkout'),
  'https://abliterated.app/api/checkout',
);
assert.equal(
  billingApiUrl({ billingSiteUrl: 'https://x.test' }, 'api/checkout/solana'),
  'https://x.test/api/checkout/solana',
);
assert.equal(
  billingApiUrl('https://x.test/', '/api/redeem'),
  'https://x.test/api/redeem',
);
assert.ok(
  billingApiUrl(null, `/api/checkout/session?session_id=${encodeURIComponent('cs_test_abc')}`).includes(
    'session_id=cs_test_abc',
  ),
);

assert.equal(
  extractStripeSessionId('https://checkout.stripe.com/c/pay/cs_test_a1b2c3d4#fidkdWx'),
  'cs_test_a1b2c3d4',
);
assert.equal(
  extractStripeSessionId('https://checkout.stripe.com/c/pay/cs_live_ZZ99#x'),
  'cs_live_ZZ99',
);
assert.equal(extractStripeSessionId('no session here'), null);
assert.equal(extractStripeSessionId('cs_test_only'), 'cs_test_only');

assert.equal(
  parseLicenseDeepLink('abliterated://license?key=ABLIT-PRO-TEST-0001'),
  'ABLIT-PRO-TEST-0001',
);
assert.equal(
  parseLicenseDeepLink('abliterated://license?key=ABLIT-TEAM-AAAA-BBBB&x=1'),
  'ABLIT-TEAM-AAAA-BBBB',
);
assert.equal(parseLicenseDeepLink('abliterated://license'), null);
assert.equal(parseLicenseDeepLink('https://abliterated.app/license?key=ABLIT-PRO-TEST-0001'), null);
assert.equal(parseLicenseDeepLink('abliterated://other?key=ABLIT-PRO-TEST-0001'), null);

assert.ok(BILLING_PLANS.includes('starter_monthly'));
assert.ok(BILLING_PLANS.includes('pro_monthly'));
assert.ok(BILLING_PLANS.includes('pro_yearly'));
assert.ok(BILLING_PLANS.includes('team_monthly'));
assert.equal(BILLING_PLANS.length, 4);


assert.equal(
  billingApiUrl(null, '/api/billing/portal'),
  'https://abliterated.app/api/billing/portal',
);
assert.equal(
  billingApiUrl({ billingSiteUrl: 'https://x.test' }, '/api/billing/setup-card'),
  'https://x.test/api/billing/setup-card',
);
assert.equal(
  billingApiUrl(null, '/api/checkout/crypto'),
  'https://abliterated.app/api/checkout/crypto',
);
assert.ok(
  billingApiUrl(null, `/api/checkout/crypto?invoiceId=${encodeURIComponent('inv_abc')}`).includes(
    'invoiceId=inv_abc',
  ),
);
assert.equal(
  billingApiUrl(null, '/api/checkout/crypto/confirm'),
  'https://abliterated.app/api/checkout/crypto/confirm',
);
assert.equal(
  billingApiUrl(null, `/checkout/crypto?invoiceId=${encodeURIComponent('inv_1')}`),
  'https://abliterated.app/checkout/crypto?invoiceId=inv_1',
);

assert.equal(FALLBACK_CREDIT_PACKS.length, 3);
assert.ok(FALLBACK_CREDIT_PACKS.some((p) => p.id === 'credits_5m'));
assert.ok(FALLBACK_CREDIT_PACKS.some((p) => p.id === 'credits_20m'));
assert.ok(FALLBACK_CREDIT_PACKS.some((p) => p.id === 'credits_50m'));
assert.ok(typeof FALLBACK_CREDIT_PACKS[0].label === 'string');
assert.ok(FALLBACK_CREDIT_PACKS[0].tokens > 0);
assert.ok(FALLBACK_CREDIT_PACKS[0].usd > 0);

assert.equal(typeof mod.createStripeCheckout, 'function');
assert.equal(typeof mod.getCheckoutSession, 'function');
assert.equal(typeof mod.openCustomerPortal, 'function');
assert.equal(typeof mod.setupCard, 'function');
assert.equal(typeof mod.listCryptoCheckout, 'function');
assert.equal(typeof mod.createCryptoInvoice, 'function');
assert.equal(typeof mod.getCryptoInvoice, 'function');
assert.equal(typeof mod.confirmCryptoInvoice, 'function');

// --- Mock HTTP Server: Automated Stripe Payment Integration Tests ---
import http from 'node:http';

const mockServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let body = '';
  for await (const chunk of req) body += chunk;
  const json = body ? JSON.parse(body) : null;

  if (url.pathname === '/api/checkout' && req.method === 'POST') {
    if (!json?.email || !json.email.includes('@')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Valid email required' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        url: 'https://checkout.stripe.com/c/pay/cs_test_mock12345#token',
        sessionId: 'cs_test_mock12345',
        customerId: 'cus_test_123',
        mode: 'subscription',
      }),
    );
  }

  if (url.pathname === '/api/checkout/session' && req.method === 'GET') {
    const sid = url.searchParams.get('session_id');
    if (sid === 'cs_test_completed') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({
          session_id: 'cs_test_completed',
          status: 'complete',
          payment_status: 'paid',
          plan: 'pro_monthly',
          seats: 1,
          email: 'operator@abliterated.app',
          license: {
            key: 'ABLIT-PRO-MOCK-9999',
            prefix: 'ABLIT-PRO',
            signed: true,
            plan: 'pro_monthly',
          },
        }),
      );
    }
    if (sid === 'cs_test_flat_license') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({
          session_id: 'cs_test_flat_license',
          status: 'complete',
          payment_status: 'paid',
          licenseKey: 'ABLIT-PRO-FLAT-1111',
        }),
      );
    }
    if (sid === 'cs_test_pending') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({
          session_id: 'cs_test_pending',
          status: 'open',
          payment_status: 'unpaid',
          license: null,
        }),
      );
    }
    if (sid === 'cs_test_expired') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({
          session_id: 'cs_test_expired',
          status: 'expired',
          payment_status: 'unpaid',
          license: null,
        }),
      );
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Session not found' }));
  }

  if (url.pathname === '/api/billing/setup-card' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        url: 'https://checkout.stripe.com/c/setup/cs_test_setup_card',
        customerId: 'cus_test_setup_123',
      }),
    );
  }

  if (url.pathname === '/api/billing/portal' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        url: 'https://billing.stripe.com/p/session/portal_test_session',
        customerId: 'cus_test_portal_123',
      }),
    );
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
const mockPort = mockServer.address().port;
const mockSiteUrl = `http://127.0.0.1:${mockPort}`;

try {
  // 1. Test Stripe Checkout Creation
  const checkoutRes = await mod.createStripeCheckout(mockSiteUrl, {
    plan: 'pro_monthly',
    email: 'operator@abliterated.app',
    client_reference_id: 'dev_mock_device_1',
  });
  assert.equal(checkoutRes.url, 'https://checkout.stripe.com/c/pay/cs_test_mock12345#token');
  assert.equal(checkoutRes.sessionId, 'cs_test_mock12345');
  assert.equal(checkoutRes.customerId, 'cus_test_123');
  assert.equal(checkoutRes.mode, 'subscription');

  // Verify extraction of session ID from checkout URL
  assert.equal(mod.extractStripeSessionId(checkoutRes.url), 'cs_test_mock12345');

  // Test Stripe Checkout validation error (invalid email)
  await assert.rejects(
    async () => {
      await mod.createStripeCheckout(mockSiteUrl, {
        plan: 'pro_monthly',
        email: 'invalid-email',
      });
    },
    (err) => err.status === 400 && err.message.includes('Valid email required'),
  );

  // 2. Test Stripe Session Polling: Completed with nested license
  const sessionCompleted = await mod.getCheckoutSession(mockSiteUrl, 'cs_test_completed');
  assert.equal(sessionCompleted.session_id, 'cs_test_completed');
  assert.equal(sessionCompleted.status, 'complete');
  assert.equal(sessionCompleted.payment_status, 'paid');
  assert.equal(sessionCompleted.license?.key, 'ABLIT-PRO-MOCK-9999');
  assert.equal(sessionCompleted.license?.signed, true);

  // 3. Test Stripe Session Polling: Completed with flat licenseKey
  const sessionFlat = await mod.getCheckoutSession(mockSiteUrl, 'cs_test_flat_license');
  assert.equal(sessionFlat.license?.key, 'ABLIT-PRO-FLAT-1111');

  // 4. Test Stripe Session Polling: Pending (unpaid)
  const sessionPending = await mod.getCheckoutSession(mockSiteUrl, 'cs_test_pending');
  assert.equal(sessionPending.status, 'open');
  assert.equal(sessionPending.payment_status, 'unpaid');
  assert.equal(sessionPending.license, null);

  // 5. Test Stripe Session Polling: Expired
  const sessionExpired = await mod.getCheckoutSession(mockSiteUrl, 'cs_test_expired');
  assert.equal(sessionExpired.status, 'expired');
  assert.equal(sessionExpired.license, null);

  // 6. Test Client-side ID validation (must start with cs_)
  await assert.rejects(
    async () => {
      await mod.getCheckoutSession(mockSiteUrl, 'invalid_session_id');
    },
    (err) => err.status === 400 && err.message.includes('must start with cs_'),
  );

  // 7. Test Save Card (SetupIntent)
  const setupRes = await mod.setupCard(mockSiteUrl, { email: 'operator@abliterated.app' });
  assert.equal(setupRes.url, 'https://checkout.stripe.com/c/setup/cs_test_setup_card');
  assert.equal(setupRes.customerId, 'cus_test_setup_123');

  // 8. Test Customer Portal
  const portalRes = await mod.openCustomerPortal(mockSiteUrl, { email: 'operator@abliterated.app' });
  assert.equal(portalRes.url, 'https://billing.stripe.com/p/session/portal_test_session');
  assert.equal(portalRes.customerId, 'cus_test_portal_123');
} finally {
  await new Promise((resolve) => mockServer.close(resolve));
}

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-billing-api: ok (all Stripe payment integration tests passed)');
