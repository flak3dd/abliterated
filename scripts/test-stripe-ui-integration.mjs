#!/usr/bin/env node
/**
 * UI Integration Test Suite for Stripe Payment Flow.
 * Validates BillingTab UI rendering, interactive triggers, states, error feedback,
 * polling resume, and Customer Portal / Card Setup actions.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-stripe-ui');
// Build a test bundle using Vite (handles TSX, imports, aliases seamlessly)
const { build } = await import('vite');
await build({
  root,
  logLevel: 'error',
  build: {
    outDir,
    emptyOutDir: true,
    lib: {
      entry: path.resolve(root, 'src/components/settings/BillingTab.tsx'),
      name: 'BillingTabTest',
      formats: ['es'],
      fileName: () => 'BillingTabBundle.js',
    },
    rollupOptions: {
      external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/server'],
    },
  },
});

const { renderToStaticMarkup } = await import('react-dom/server');
const React = await import('react');
const billingTabMod = await import(pathToFileURL(path.join(outDir, 'BillingTabBundle.js')).href);
const licenseMod = await import(pathToFileURL(path.resolve(root, 'dist-test-stripe-ui/lib/license.js')).href).catch(async () => {
  // also bundle license or import from src via vite
  const res = await build({
    root,
    logLevel: 'error',
    build: {
      outDir: path.join(outDir, 'license'),
      emptyOutDir: true,
      lib: {
        entry: path.resolve(root, 'src/lib/license.ts'),
        formats: ['es'],
        fileName: () => 'licenseBundle.js',
      },
      rollupOptions: {
        external: ['react', 'react/jsx-runtime'],
      },
    },
  });
  return import(pathToFileURL(path.join(outDir, 'license/licenseBundle.js')).href);
});

const { BillingTab } = billingTabMod;
const { getLicenseState, LICENSE_TEST_KEYS } = licenseMod;

console.log('=== Running Stripe UI Integration Tests ===\n');

function createDefaultProps(overrides = {}) {
  const license = getLicenseState({ licenseKey: '' });
  const pollAbortRef = { current: 0 };
  const cryptoPollAbortRef = { current: 0 };

  return {
    settings: {
      deviceId: 'dev_test_123',
      billingSiteUrl: 'http://127.0.0.1:17322',
      accountEmail: 'user@example.com',
      billingEmail: 'user@example.com',
      licenseKey: '',
    },
    license,
    enabledMcp: 0,
    licenseDraft: '',
    setLicenseDraft: () => {},
    licenseMsg: '',
    setLicenseMsg: () => {},
    persistLicense: (k) => getLicenseState({ licenseKey: k }),
    redeemCode: '',
    setRedeemCode: () => {},
    redeemBusy: false,
    startRedeem: async () => {},
    billingEmail: 'user@example.com',
    setBillingEmail: () => {},
    rememberEmail: () => {},
    billingPlan: 'pro_monthly',
    setBillingPlan: () => {},
    billingSeats: 1,
    setBillingSeats: () => {},
    planBusy: null,
    planMsg: '',
    setPlanMsg: () => {},
    startStripeCheckout: async () => {},
    startSolanaCheckout: async () => {},
    pendingStripeSession: null,
    pollStripeUntilLicense: async () => {},
    pendingSolanaId: null,
    pollSolanaUntilLicense: async () => {},
    effectiveBillingEmail: () => 'user@example.com',
    pollAbortRef,
    setPlanBusy: () => {},
    solanaPayUrl: '',
    solanaAmount: '',
    cardsBusy: null,
    cardsMsg: '',
    startSaveCard: async () => {},
    startCustomerPortal: async () => {},
    cryptoBusy: null,
    loadCryptoCatalog: async () => {},
    creditPackId: 'credits_20m',
    setCreditPackId: () => {},
    creditPacks: [],
    cryptoAsset: 'usdc_sol',
    setCryptoAsset: () => {},
    startCryptoCheckout: async () => {},
    pendingCryptoId: null,
    cryptoPollAbortRef,
    setCryptoBusy: () => {},
    pollCryptoUntilPaid: async () => {},
    cryptoPayUrl: '',
    cryptoPayUri: '',
    cryptoAmountLabel: '',
    cryptoMsg: '',
    setCryptoMsg: () => {},
    ...overrides,
  };
}

// 1. Initial Default State Rendering
{
  const props = createDefaultProps();
  const html = renderToStaticMarkup(React.createElement(BillingTab, props));

  assert.ok(html.includes('Pay with Card (Stripe)'), 'Renders Stripe checkout CTA button');
  assert.ok(html.includes('Manage Subscription (Portal)'), 'Renders Stripe Customer Portal CTA button');
  assert.ok(html.includes('Save a Card'), 'Renders Stripe Card Setup CTA button');
  assert.ok(html.includes('value="user@example.com"'), 'Renders pre-populated billing email');
  assert.ok(html.includes('Pro $29/mo'), 'Displays pricing hint for plans');
  console.log('  ✓ 1. Initial Default State Renders Stripe UI elements properly');
}

// 2. Stripe Busy States (Opening checkout / button disabled)
{
  const props = createDefaultProps({
    planBusy: 'stripe',
    planMsg: 'Creating Stripe checkout…',
  });
  const html = renderToStaticMarkup(React.createElement(BillingTab, props));

  assert.ok(html.includes('Opening Card Checkout…'), 'Reflects busy button text during checkout initiation');
  assert.ok(html.includes('disabled=""') || html.includes('disabled'), 'Checkout button is disabled while busy');
  assert.ok(html.includes('Creating Stripe checkout…'), 'Displays planMsg status message');
  console.log('  ✓ 2. Stripe busy states disable actions and reflect status messages');
}

// 3. Customer Portal & Card Setup Busy States
{
  const propsPortal = createDefaultProps({
    cardsBusy: 'portal',
    cardsMsg: 'Opening customer portal…',
  });
  const htmlPortal = renderToStaticMarkup(React.createElement(BillingTab, propsPortal));
  assert.ok(htmlPortal.includes('Opening customer portal…'), 'Displays cardsMsg for customer portal');

  const propsCard = createDefaultProps({
    cardsBusy: 'setup',
    cardsMsg: 'Opening Stripe card setup…',
  });
  const htmlCard = renderToStaticMarkup(React.createElement(BillingTab, propsCard));
  assert.ok(htmlCard.includes('Opening Stripe card setup…'), 'Displays cardsMsg for save card setup');
  console.log('  ✓ 3. Customer portal and card setup display busy indicators and messages');
}

// 4. Pending Stripe Session & "Resume Stripe poll" button
{
  const props = createDefaultProps({
    pendingStripeSession: 'cs_test_ui_mock_123',
    planMsg: 'Stripe: unpaid — waiting for license… (2)',
  });
  const html = renderToStaticMarkup(React.createElement(BillingTab, props));

  assert.ok(html.includes('Resume Stripe poll'), 'Renders "Resume Stripe poll" button when pending session exists');
  assert.ok(html.includes('waiting for license…'), 'Displays active polling progress in UI');
  console.log('  ✓ 4. Pending Stripe session exposes "Resume Stripe poll" action');
}

// 5. Team Plan Seats selector UI
{
  const props = createDefaultProps({
    billingPlan: 'team_monthly',
    billingSeats: 5,
  });
  const html = renderToStaticMarkup(React.createElement(BillingTab, props));

  assert.ok(html.includes('Seats'), 'Displays Seats field for team plan');
  assert.ok(html.includes('value="5"'), 'Displays configured seats value');
  console.log('  ✓ 5. Team plan activates seat count selector');
}

// 6. License Upgrade Reflection after Stripe Success
{
  const proLicense = getLicenseState({ licenseKey: LICENSE_TEST_KEYS.pro });
  const props = createDefaultProps({
    license: proLicense,
    planMsg: 'Stripe paid — activated Pro.',
  });
  const html = renderToStaticMarkup(React.createElement(BillingTab, props));

  assert.ok(html.includes('Pro (pro)'), 'Renders upgraded Pro badge');
  assert.ok(html.includes('Full unrestricted access'), 'Reflects unrestricted access');
  assert.ok(html.includes('Stripe paid — activated Pro.'), 'Displays activation success message');
  console.log('  ✓ 6. Upgraded license state renders successfully in UI hero card');
}

// Clean up test dist directory
fs.rmSync(outDir, { recursive: true, force: true });

console.log('\n=== All Stripe UI Integration Tests PASSED! ===');
