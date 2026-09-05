/**
 * Scan Abliterated skill roots (bundled / global / workspace) and parse SKILL.md frontmatter.
 * Workspace skills override global, which override bundled (same slug/id).
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isInsideRoot } from './search.js';

const MAX_SKILL_BYTES = 256 * 1024;

/**
 * @param {string} appRoot
 * @param {string} [workspaceRoot]
 * @param {string} [home]
 */
export function skillRoots(appRoot, workspaceRoot = '', home = os.homedir()) {
  const roots = [];
  const app = String(appRoot || '').trim();
  if (app) roots.push({ source: 'bundled', root: path.join(path.resolve(app), 'skills') });
  const h = String(home || '').trim() || os.homedir();
  if (h) roots.push({ source: 'global', root: path.join(path.resolve(h), '.abliterated', 'skills') });
  const ws = String(workspaceRoot || '').trim();
  if (ws && ws !== '/workspace' && ws !== '.') {
    roots.push({ source: 'workspace', root: path.join(path.resolve(ws), '.ablit', 'skills') });
  }
  return roots;
}

/**
 * @param {string} raw
 */
export function parseSkillMarkdown(raw) {
  const text = String(raw ?? '');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) {
    return { name: '', description: '', body: text.trim() };
  }
  const fm = m[1];
  const body = (m[2] || '').trim();
  let name = '';
  let description = '';
  for (const line of fm.split(/\r?\n/)) {
    const nm = line.match(/^name:\s*(.*)$/i);
    if (nm) {
      name = stripYamlScalar(nm[1]);
      continue;
    }
    const dm = line.match(/^description:\s*(.*)$/i);
    if (dm) {
      description = stripYamlScalar(dm[1]);
    }
  }
  return { name, description, body };
}

function stripYamlScalar(v) {
  let s = String(v ?? '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s.trim();
}

export function slugify(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * @param {{ source: string, root: string }} entry
 */
async function scanRoot(entry) {
  const out = [];
  let dirents;
  try {
    dirents = await readdir(entry.root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    const slug = d.name;
    if (!slug || slug.startsWith('.')) continue;
    const skillPath = path.join(entry.root, slug, 'SKILL.md');
    try {
      const st = await stat(skillPath);
      if (!st.isFile() || st.size > MAX_SKILL_BYTES) continue;
      const raw = await readFile(skillPath, 'utf8');
      const parsed = parseSkillMarkdown(raw);
      const id = slugify(slug) || slugify(parsed.name) || slug;
      out.push({
        id,
        name: parsed.name || slug,
        description: parsed.description || '',
        path: skillPath,
        body: parsed.body || raw.trim(),
        source: entry.source,
      });
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

/**
 * @param {string} appRoot
 * @param {string} [workspaceRoot]
 * @param {string} [home]
 */
export async function listSkills(appRoot, workspaceRoot = '', home = os.homedir()) {
  /** @type {Map<string, any>} */
  const byId = new Map();
  for (const root of skillRoots(appRoot, workspaceRoot, home)) {
    const found = await scanRoot(root);
    for (const skill of found) {
      byId.set(skill.id, skill);
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {string} skillId
 * @param {string} appRoot
 * @param {string} [workspaceRoot]
 * @param {string} [home]
 */
export async function readSkill(skillId, appRoot, workspaceRoot = '', home = os.homedir()) {
  const id = slugify(skillId) || String(skillId || '').trim();
  if (!id) throw new Error('missing skill_id');
  const skills = await listSkills(appRoot, workspaceRoot, home);
  const hit = skills.find((s) => s.id === id || slugify(s.name) === id);
  if (!hit) throw new Error(`skill not found: ${id}`);
  return hit;
}

/**
 * @param {{ name: string, description: string, body: string, scope?: string }} input
 * @param {string} appRoot
 * @param {string} [workspaceRoot]
 * @param {string} [home]
 */
export async function writeSkill(input, appRoot, workspaceRoot = '', home = os.homedir()) {
  const name = String(input?.name || '').trim();
  const description = String(input?.description || '').trim();
  const body = String(input?.body || '').trim();
  const scope = String(input?.scope || 'workspace').trim().toLowerCase() === 'user' ? 'user' : 'workspace';
  if (!name) throw new Error('skill name required');
  if (!description) throw new Error('skill description required');
  if (!body) throw new Error('skill body required');
  const id = slugify(name);
  if (!id) throw new Error('invalid skill name');

  let root;
  if (scope === 'user') {
    root = path.join(path.resolve(home || os.homedir()), '.abliterated', 'skills');
  } else {
    const ws = String(workspaceRoot || '').trim();
    if (!ws || ws === '/workspace' || ws === '.') {
      throw new Error('workspace root required for workspace-scoped skills');
    }
    root = path.join(path.resolve(ws), '.ablit', 'skills');
  }

  const dir = path.join(root, id);
  await mkdir(dir, { recursive: true });
  const skillPath = path.join(dir, 'SKILL.md');
  const markdown = `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`;
  await writeFile(skillPath, markdown, 'utf8');
  return {
    id,
    name,
    description,
    path: skillPath,
    body,
    source: scope === 'user' ? 'global' : 'workspace',
  };
}

/**
 * @param {string} abs
 * @param {string} appRoot
 * @param {string} [workspaceRoot]
 * @param {string} [home]
 */
export function isAllowedSkillPath(abs, appRoot, workspaceRoot = '', home = os.homedir()) {
  const target = path.resolve(String(abs || ''));
  if (!target) return false;
  for (const { root } of skillRoots(appRoot, workspaceRoot, home)) {
    if (isInsideRoot(path.resolve(root), target)) return true;
  }
  return false;
}
