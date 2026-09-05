/**
 * Auto-load workspace convention files (AGENTS.md and cousins) for the system prompt.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { isInsideRoot } from './search.js';

export const MEMORY_FILES = [
  'AGENTS.md',
  'agents.md',
  'CLAUDE.md',
  '.cursorrules',
  '.ablit/rules.md',
  '.ablit/AGENTS.md',
];

const MAX_FILE_BYTES = 120_000;
const MAX_RULE_FILES = 8;

async function readIfFile(root, rel) {
  const abs = path.resolve(root, rel);
  if (!isInsideRoot(root, abs)) return null;
  try {
    const st = await stat(abs);
    if (!st.isFile() || st.size <= 0 || st.size > MAX_FILE_BYTES) return null;
    const text = await readFile(abs, 'utf8');
    const trimmed = text.trim();
    if (!trimmed) return null;
    return { path: rel.replace(/\\/g, '/'), text: trimmed };
  } catch {
    return null;
  }
}

async function readCursorRulesDir(root) {
  const dir = path.resolve(root, '.cursor', 'rules');
  if (!isInsideRoot(root, dir)) return [];
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (out.length >= MAX_RULE_FILES) break;
    if (!/\.(md|mdc|txt)$/i.test(name)) continue;
    const hit = await readIfFile(root, path.join('.cursor', 'rules', name));
    if (hit) out.push(hit);
  }
  return out;
}

/**
 * @param {string} root
 * @returns {Promise<Array<{ path: string, text: string }>>}
 */
export async function readProjectMemory(root) {
  const base = String(root || '').trim();
  if (!base) return [];
  const files = [];
  const seen = new Set();
  for (const rel of MEMORY_FILES) {
    const hit = await readIfFile(base, rel);
    if (!hit || seen.has(hit.path.toLowerCase())) continue;
    seen.add(hit.path.toLowerCase());
    files.push(hit);
  }
  for (const hit of await readCursorRulesDir(base)) {
    if (seen.has(hit.path.toLowerCase())) continue;
    seen.add(hit.path.toLowerCase());
    files.push(hit);
  }
  return files;
}
