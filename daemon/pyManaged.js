/**
 * PEP 668 / Homebrew "externally-managed-environment" handling.
 * pip against system Python is rewritten to a workspace .venv.
 */

const PIP_MUTATE_RE =
  /\b(?:pip3?|(?:python3?|py)\s+-m\s+pip)\s+(install|uninstall)\b/i;

const ISOLATED_RE =
  /(?:^|[/\s\\])\.venv[/\s\\]|[/\\]venv[/\\]|\buv\s+pip\b|\bpoetry\s+|\bpipenv\s+|\bconda\s+|\bvirtualenv\b|--break-system-packages|\bVIRTUAL_ENV=/i;

export const PEP668_NOTICE =
  'ablit: PEP 668 — system Python is externally managed; using workspace .venv';

export function isExternallyManagedError(text) {
  const t = String(text || '');
  if (/\bexternally-managed-environment\b/i.test(t)) return true;
  if (/This environment is externally managed/i.test(t)) return true;
  if (/To install Python packages system-wide, try brew install/i.test(t)) return true;
  return false;
}

export function looksLikePipMutate(command) {
  const c = String(command || '');
  if (!PIP_MUTATE_RE.test(c)) return false;
  if (/\bsudo\b/.test(c)) return false;
  return true;
}

export function alreadyIsolatedPython(command) {
  return ISOLATED_RE.test(String(command || ''));
}

/** True when this exec should be routed through workspace .venv. */
export function shouldUseWorkspaceVenv(command) {
  return looksLikePipMutate(command) && !alreadyIsolatedPython(command);
}

export function wrapWithWorkspaceVenv(command, platform = process.platform) {
  const cmd = String(command || '').trim();
  if (!cmd) return cmd;
  if (platform === 'win32') {
    return (
      '(if not exist .venv\\Scripts\\python.exe python -m venv .venv) ' +
      `&& echo ${PEP668_NOTICE} ` +
      `&& set "PATH=%CD%\\.venv\\Scripts;%PATH%" && ${cmd}`
    );
  }
  const q = JSON.stringify(PEP668_NOTICE);
  return (
    '{ [ -x .venv/bin/python ] || python3 -m venv .venv || python -m venv .venv; } ' +
    `&& echo ${q} ` +
    `&& PATH="$PWD/.venv/bin:$PATH" ${cmd}`
  );
}

export function pep668Hint(command) {
  return (
    'ablit: PEP 668 blocked system pip. Re-run the same command — the bridge will use workspace .venv.\n' +
    'Manual: python3 -m venv .venv && .venv/bin/pip install <packages>\n' +
    (command ? `Original: ${command}\n` : '')
  );
}
