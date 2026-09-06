import assert from 'node:assert/strict';
import {
  alreadyIsolatedPython,
  isExternallyManagedError,
  looksLikePipMutate,
  looksLikePythonCommand,
  pep668Hint,
  shouldUseWorkspaceVenv,
  wrapWithWorkspaceVenv,
  PEP668_NOTICE,
  VENV_NOTICE,
} from './pyManaged.js';

assert.equal(isExternallyManagedError("error: externally-managed-environment\\n"), true);
assert.equal(isExternallyManagedError("ModuleNotFoundError: numpy"), false);
assert.equal(looksLikePipMutate("pip install requests"), true);
assert.equal(looksLikePipMutate("pip3 install -e ."), true);
assert.equal(looksLikePipMutate("python3 -m pip install flask"), true);
assert.equal(looksLikePipMutate("python -m pip uninstall foo"), true);
assert.equal(looksLikePipMutate("pip list"), false);
assert.equal(looksLikePipMutate("sudo pip install foo"), false);
assert.equal(looksLikePipMutate("npm install"), false);

assert.equal(looksLikePythonCommand("python3 app.py"), true);
assert.equal(looksLikePythonCommand("python script.py"), true);
assert.equal(looksLikePythonCommand("py -3 main.py"), true);
assert.equal(looksLikePythonCommand("pip list"), true);
assert.equal(looksLikePythonCommand("pip3 show requests"), true);
assert.equal(looksLikePythonCommand("FOO=1 BAR=2 python3 -c \"print(1)\""), true);
assert.equal(looksLikePythonCommand("cd src && python3 app.py"), true);
assert.equal(looksLikePythonCommand("echo hi; python3 -m pytest"), true);
assert.equal(looksLikePythonCommand("echo python is cool"), false);
assert.equal(looksLikePythonCommand("npm install"), false);
assert.equal(looksLikePythonCommand("sudo python3 app.py"), false);
assert.equal(looksLikePythonCommand(""), false);

assert.equal(alreadyIsolatedPython(".venv/bin/pip install foo"), true);
assert.equal(alreadyIsolatedPython(".venv/bin/python app.py"), true);
assert.equal(alreadyIsolatedPython("uv pip install foo"), true);
assert.equal(alreadyIsolatedPython("pip install --break-system-packages foo"), true);
assert.equal(alreadyIsolatedPython("pip install foo"), false);

assert.equal(shouldUseWorkspaceVenv("pip install rich"), true);
assert.equal(shouldUseWorkspaceVenv("python3 app.py"), true);
assert.equal(shouldUseWorkspaceVenv("pip list"), true);
assert.equal(shouldUseWorkspaceVenv(".venv/bin/pip install rich"), false);
assert.equal(shouldUseWorkspaceVenv(".venv/bin/python app.py"), false);
assert.equal(shouldUseWorkspaceVenv("echo python is cool"), false);
assert.equal(shouldUseWorkspaceVenv("echo hi"), false);
assert.equal(shouldUseWorkspaceVenv("npm install"), false);

assert.equal(VENV_NOTICE, 'ablit: using workspace .venv for Python');
assert.match(PEP668_NOTICE, /PEP 668/);

const wrappedPip = wrapWithWorkspaceVenv('pip install rich', 'darwin');
assert.match(wrappedPip, /python3 -m venv \.venv/);
assert.match(wrappedPip, /PATH="\$PWD\/\.venv\/bin:\$PATH"/);
assert.match(wrappedPip, /VIRTUAL_ENV="\$PWD\/\.venv"/);
assert.match(wrappedPip, /pip install rich/);
assert.match(wrappedPip, /externally managed/);

const wrappedPy = wrapWithWorkspaceVenv('python3 app.py', 'darwin');
assert.match(wrappedPy, /python3 -m venv \.venv/);
assert.match(wrappedPy, /VIRTUAL_ENV="\$PWD\/\.venv"/);
assert.match(wrappedPy, /python3 app.py/);
assert.match(wrappedPy, /using workspace \.venv for Python/);
assert.doesNotMatch(wrappedPy, /PEP 668/);

const win = wrapWithWorkspaceVenv('pip install rich', 'win32');
assert.match(win, /\.venv\\Scripts/);
assert.match(win, /VIRTUAL_ENV=%CD%\\.venv/);
const hint = pep668Hint('pip install foo');
assert.match(hint, /PEP 668/);
assert.match(hint, /pip install foo/);

console.log('pyManaged.test.js ok');

