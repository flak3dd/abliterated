import assert from 'node:assert/strict';
import {
  alreadyIsolatedPython,
  isExternallyManagedError,
  looksLikePipMutate,
  pep668Hint,
  shouldUseWorkspaceVenv,
  wrapWithWorkspaceVenv,
} from './pyManaged.js';

assert.equal(isExternallyManagedError('error: externally-managed-environment\n'), true);
assert.equal(
  isExternallyManagedError('× This environment is externally managed\n╰─> To install Python packages system-wide, try brew install\n'),
  true,
);
assert.equal(isExternallyManagedError('ModuleNotFoundError: numpy'), false);

assert.equal(looksLikePipMutate('pip install requests'), true);
assert.equal(looksLikePipMutate('pip3 install -e .'), true);
assert.equal(looksLikePipMutate('python3 -m pip install flask'), true);
assert.equal(looksLikePipMutate('python -m pip uninstall foo'), true);
assert.equal(looksLikePipMutate('pip list'), false);
assert.equal(looksLikePipMutate('sudo pip install foo'), false);
assert.equal(looksLikePipMutate('npm install'), false);

assert.equal(alreadyIsolatedPython('.venv/bin/pip install foo'), true);
assert.equal(alreadyIsolatedPython('uv pip install foo'), true);
assert.equal(alreadyIsolatedPython('pip install --break-system-packages foo'), true);
assert.equal(alreadyIsolatedPython('pip install foo'), false);

assert.equal(shouldUseWorkspaceVenv('pip install rich'), true);
assert.equal(shouldUseWorkspaceVenv('.venv/bin/pip install rich'), false);
assert.equal(shouldUseWorkspaceVenv('echo hi'), false);

const wrapped = wrapWithWorkspaceVenv('pip install rich', 'darwin');
assert.match(wrapped, /python3 -m venv \.venv/);
assert.match(wrapped, /PATH="\$PWD\/\.venv\/bin:\$PATH"/);
assert.match(wrapped, /pip install rich/);
assert.match(wrapped, /externally managed/);

const win = wrapWithWorkspaceVenv('pip install rich', 'win32');
assert.match(win, /\.venv\\Scripts/);

const hint = pep668Hint('pip install foo');
assert.match(hint, /PEP 668/);
assert.match(hint, /pip install foo/);

console.log('pyManaged.test.js ok');
