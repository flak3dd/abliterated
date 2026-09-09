/** Workspace `.ablit/rules.md` — short operator rules pinned into the agent prompt. */

import { bridge } from './bridgeClient';

export const PROJECT_RULES_PATH = '.ablit/rules.md';

export async function loadProjectRules(): Promise<string> {
  if (!bridge.connected) return '';
  try {
    return await bridge.readFile(PROJECT_RULES_PATH);
  } catch {
    return '';
  }
}

export async function saveProjectRules(text: string): Promise<void> {
  if (!bridge.connected) {
    throw new Error('Bridge restarting — cannot write .ablit/rules.md until hello.');
  }
  const body = text.endsWith('\n') ? text : `${text}\n`;
  try {
    await bridge.createDirectory('.ablit');
  } catch {
    /* exists */
  }
  const ok = await bridge.writeFile(PROJECT_RULES_PATH, body);
  if (!ok) throw new Error('Failed to write .ablit/rules.md');
}

export function filterPinnedProjectMemory<T extends { path: string }>(
  files: T[],
  pinned: boolean,
): T[] {
  if (pinned) return files;
  return files.filter((f) => f.path.replace(/\\/g, '/') !== PROJECT_RULES_PATH);
}
