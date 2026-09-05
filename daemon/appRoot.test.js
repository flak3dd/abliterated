import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appRootRefuseMessage, isInsideAppRoot, resolveAppRoot } from './appRoot.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const install = path.resolve(here, '..');

assert.equal(resolveAppRoot({}, here), install);
assert.equal(resolveAppRoot({ ABLIT_APP_ROOT: '/tmp/ablit-app' }, here), path.resolve('/tmp/ablit-app'));

assert.equal(isInsideAppRoot(install, install), true);
assert.equal(isInsideAppRoot(install, path.join(install, 'src', 'App.tsx')), true);
assert.equal(isInsideAppRoot(install, path.join(install, '..')), false);
assert.equal(isInsideAppRoot(install, path.join(os.tmpdir(), 'project')), false);
assert.equal(isInsideAppRoot(install, path.join(install, '..', 'abliterated', 'daemon')), true);

const msg = appRootRefuseMessage('workspace');
assert.match(msg, /install/i);
assert.match(msg, /working directory/i);

console.log('appRoot.test.js ok');
