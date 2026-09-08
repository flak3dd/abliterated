#!/usr/bin/env node
/** Regression: admin/dev unlocks stay off outside Vite DEV. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-license-harden');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const shim = path.join(outDir, 'vite-env-shim.d.ts');
fs.writeFileSync(
  shim,
  [
    'interface ImportMetaEnv {',
    '  readonly DEV?: boolean;',
    '  readonly [key: string]: string | boolean | undefined;',
    '}',
    'interface ImportMeta {',
    '  readonly env: ImportMetaEnv;',
    '}',
    '',
  ].join('\n'),
);
// Under Node without Vite, isDevRuntime() is false (production path).
execFileSync(
  'npx',
  [
    'tsc',
    'src/lib/license.ts',
    shim,
    '--outDir',
    outDir,
    '--module',
    'esnext',
    '--target',
    'es2022',
    '--moduleResolution',
    'bundler',
    '--strict',
  ],
  { cwd: root, stdio: 'inherit' },
);
const mod = await import(pathToFileURL(path.join(outDir, 'license.js')).href);
const {
  resolveLicenseTier,
  verifyAdminLogin,
  isDevRuntime,
  getLicenseState,
  ADMIN_LICENSE_KEY,
} = mod;

assert.equal(isDevRuntime(), false, 'Node/tsc runtime must not look like Vite DEV');
assert.equal(resolveLicenseTier(ADMIN_LICENSE_KEY), 'free');
assert.equal(resolveLicenseTier('ABLIT-DEV-UNLOCK'), 'free');
assert.equal(resolveLicenseTier(''), 'free');
assert.equal(resolveLicenseTier('ABLIT-PRO-AAAA-BBBB'), 'pro');
assert.equal(resolveLicenseTier('ABLIT-TEAM-CCCC-DDDD'), 'team');
assert.equal(verifyAdminLogin('admin', 'abliterated'), false);
assert.equal(verifyAdminLogin('admin', ADMIN_LICENSE_KEY), false);
assert.equal(getLicenseState({ licenseKey: 'ABLIT-DEV-UNLOCK' }).tier, 'free');
assert.equal(getLicenseState({ licenseKey: 'ABLIT-DEV-UNLOCK' }).isFree, true);

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-license-harden: ok');
