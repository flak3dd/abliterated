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

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-billing-api: ok');
