/**
 * Abliterated install path. Workspace roots and file mutations must stay outside it.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInsideRoot } from './search.js';

export function resolveAppRoot(env = process.env, here = path.dirname(fileURLToPath(import.meta.url))) {
  const override = String(env.ABLIT_APP_ROOT || '').trim();
  if (override) return path.resolve(override);
  return path.resolve(here, '..');
}

export function isInsideAppRoot(appRoot, target) {
  if (!appRoot || !target) return false;
  return isInsideRoot(path.resolve(appRoot), path.resolve(String(target)));
}

export function appRootRefuseMessage(action = 'operation') {
  return `refused: ${action} inside the Abliterated install. Choose a working directory that is not the install folder.`;
}
