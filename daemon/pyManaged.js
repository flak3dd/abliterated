/**
 * Workspace Python isolation.
 * Any python/pip against system Python is rewritten through workspace .venv
 * (create if missing, then PATH-prefix). Also covers PEP 668 pip mutate.
 */

const PIP_MUTATE_RE =
  /\b(?:pip3?|(?:python3?|py)\s+-m\s+pip)\s+(install|uninstall)\b/i;

/** Command tokens that mean "this shell line runs Python tooling". */
const PYTHON_TOOL_RE = /^(?:python3?(?:\.\d+)?|py|pip3?)\b/i;

const ISOLATED_RE =
  /(?:^|[/\s\\])\.venv[/\s\\]|[/\\]venv[/\\]|\buv\s+(?:pip|run|python)\b|\bpoetry\s+|\bpipenv\s+|\bconda\s+|\bvirtualenv\b|--break-system-packages|\bVIRTUAL_ENV=/i;

export const PEP668_NOTICE =
  'ablit: PEP 668 — system Python is externally managed; using workspace .venv';

export const VENV_NOTICE = 'ablit: using workspace .venv for Python';

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

/**
 * True when a shell segment invokes python/pip (not merely mentions the word).
 * Splits on && || ; | so chained commands still match.
 */
export function looksLikePythonCommand(command) {
  const c = String(command || '');
  if (!c.trim()) return false;
  if (/\bsudo\b/.test(c)) return false;
  const parts = c.split(/(?:&&|\|\||;|\|)/);
  for (const part of parts) {
    let t = part.trim();
    if (!t) continue;
    // Strip leading env assignments: FOO=1 BAR=2 python …
    t = t.replace(/^(?:[A-Za-z_][\w]*=(?:'[^']*'|"[^"]*"|\S+)\s+)+/, '');
    if (PYTHON_TOOL_RE.test(t)) return true;
  }
  return false;
}

export function alreadyIsolatedPython(command) {
  return ISOLATED_RE.test(String(command || ''));
}

/** True when this exec should be routed through workspace .venv. */
export function shouldUseWorkspaceVenv(command) {
  if (alreadyIsolatedPython(command)) return false;
  return looksLikePipMutate(command) || looksLikePythonCommand(command);
}

export function wrapWithWorkspaceVenv(command, platform = process.platform) {
  const cmd = String(command || '').trim();
  if (!cmd) return cmd;
  const notice = looksLikePipMutate(cmd) ? PEP668_NOTICE : VENV_NOTICE;
  if (platform === 'win32') {
    return (
      '(if not exist .venv\\Scripts\\python.exe python -m venv .venv) ' +
      `&& echo ${notice} ` +
      `&& set "PATH=%CD%\\.venv\\Scripts;%PATH%" && set "VIRTUAL_ENV=%CD%\\.venv" && ${cmd}`
    );
  }
  const q = JSON.stringify(notice);
  return (
    '{ [ -x .venv/bin/python ] || python3 -m venv .venv || python -m venv .venv; } ' +
    `&& echo ${q} ` +
    `&& PATH="$PWD/.venv/bin:$PATH" VIRTUAL_ENV="$PWD/.venv" ${cmd}`
  );
}

export function pep668Hint(command) {
  return (
    'ablit: PEP 668 blocked system pip. Re-run the same command — the bridge will use workspace .venv.\n' +
    'Manual: python3 -m venv .venv && .venv/bin/pip install <packages>\n' +
    (command ? `Original: ${command}\n` : '')
  );
}
