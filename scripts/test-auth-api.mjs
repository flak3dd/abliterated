#!/usr/bin/env node
/**
 * Unit smoke for authApi URL/body helpers — no network.
 * Run: node scripts/test-auth-api.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-auth-api');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

execFileSync(
  'node_modules/.bin/tsc',
  [
    'src/lib/authApi.ts',
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

// tsc emits extensionless relative imports; Node ESM needs .js
for (const name of ['authApi.js', 'billingApi.js']) {
  const file = path.join(outDir, name);
  if (!fs.existsSync(file)) continue;
  let src = fs.readFileSync(file, 'utf8');
  src = src.replace(/from ['"](\.\/[^'"]+)['"]/g, (m, spec) =>
    spec.endsWith('.js') ? m : `from '${spec}.js'`,
  );
  fs.writeFileSync(file, src);
}

const mod = await import(pathToFileURL(path.join(outDir, 'authApi.js')).href);
const {
  DEFAULT_BILLING_SITE,
  billingSiteBase,
  signupUrl,
  loginUrl,
  signupRequestBody,
  loginEmailRequestBody,
  loginWithLoginIdRequestBody,
} = mod;

// billingApi re-exports / shared constants
assert.equal(billingSiteBase(null), DEFAULT_BILLING_SITE || 'https://abliterated.app');
assert.equal(signupUrl(null), 'https://abliterated.app/api/signup');
assert.equal(loginUrl(null), 'https://abliterated.app/api/login');
assert.equal(
  signupUrl({ billingSiteUrl: 'https://staging.example.com/' }),
  'https://staging.example.com/api/signup',
);
assert.equal(
  loginUrl('https://x.test'),
  'https://x.test/api/login',
);

const signupBody = signupRequestBody({
  email: '  User@Example.COM ',
  password: 'secret123',
  deviceId: '  device-abc-12345  ',
});
assert.deepEqual(signupBody, {
  email: 'user@example.com',
  password: 'secret123',
  deviceId: 'device-abc-12345',
});

const loginBody = loginEmailRequestBody({
  email: 'A@B.co',
  password: 'pw',
  deviceId: 'dev-1',
});
assert.deepEqual(loginBody, {
  email: 'a@b.co',
  password: 'pw',
  deviceId: 'dev-1',
});

const loginIdBody = loginWithLoginIdRequestBody({
  loginId: '  login_xyz  ',
  deviceId: ' device-9 ',
});
assert.deepEqual(loginIdBody, {
  loginId: 'login_xyz',
  deviceId: 'device-9',
});

// JSON serialization shape matches site contract
assert.equal(
  JSON.stringify(signupBody),
  JSON.stringify({ email: 'user@example.com', password: 'secret123', deviceId: 'device-abc-12345' }),
);
assert.equal(
  JSON.stringify(loginBody),
  JSON.stringify({ email: 'a@b.co', password: 'pw', deviceId: 'dev-1' }),
);
assert.equal(
  JSON.stringify(loginIdBody),
  JSON.stringify({ loginId: 'login_xyz', deviceId: 'device-9' }),
);

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-auth-api: ok');
