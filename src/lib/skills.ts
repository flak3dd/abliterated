/**
 * Skills catalog helpers (Cursor/Grok Bot-compatible SKILL.md).
 * Filesystem scan runs on the localhost bridge; this module parses, merges, and formats.
 */

export type SkillRecord = {
  id: string;
  name: string;
  description: string;
  path: string;
  body: string;
  source?: 'bundled' | 'global' | 'workspace' | string;
};

export type SkillCatalogEntry = {
  id: string;
  name: string;
  description: string;
};

export type SkillSuggestion = {
  name: string;
  description: string;
  body: string;
  reason?: string;
  scope?: 'workspace' | 'user';
};

/** Lightweight YAML frontmatter parse for name/description only. */
export function parseSkillMarkdown(raw: string): { name: string; description: string; body: string } {
  const text = String(raw ?? '');
  const m = text.match(new RegExp('^---\\r?\\n([\\s\\S]*?)\\r?\\n---\\r?\\n?([\\s\\S]*)$'));
  if (!m) {
    return { name: '', description: '', body: text.trim() };
  }
  const fm = m[1];
  const body = (m[2] || '').trim();
  let name = '';
  let description = '';
  for (const line of fm.split(new RegExp('\\r?\\n'))) {
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

function stripYamlScalar(v: string): string {
  let s = String(v ?? '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s.trim();
}

export function slugifySkillId(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Merge skill lists by id; later entries win (bundled -> global -> workspace). */
export function mergeSkillsById(layers: SkillRecord[][]): SkillRecord[] {
  const byId = new Map<string, SkillRecord>();
  for (const layer of layers) {
    for (const skill of layer) {
      const id = slugifySkillId(skill.id) || slugifySkillId(skill.name);
      if (!id) continue;
      byId.set(id, { ...skill, id });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Compact prompt block: name + description only. */
export function formatSkillsCatalogPrompt(skills: SkillCatalogEntry[]): string {
  if (!skills.length) return '';
  const lines = skills.map((s) => `- **${s.name}** (\`${s.id}\`): ${s.description || '(no description)'}`);
  return [
    '## Available skills',
    'Reusable recipes matched by description. When a skill applies to the task, call `read_skill` with that `skill_id` **before** improvising, then follow the recipe.',
    'Tools: `list_skills` (catalog), `read_skill` `{ skill_id }` (full body), `suggest_skill` (propose only), `write_skill` (save after confirm; not Plan mode).',
    'After reasoning: if you identify a clear reusable multi-step build-quality/process pattern NOT already covered by a similar skill description, call `suggest_skill` (or propose briefly in prose) and wait for user confirm before `write_skill`. Do not spam.',
    lines.join('\n'),
  ].join('\n');
}

export function skillRootHints(opts: {
  appRoot?: string;
  workspaceRoot?: string;
  homeHint?: string;
}): { bundled: string; global: string; workspace: string } {
  const app = (opts.appRoot || '').replace(/\/+$/, '');
  const home = (opts.homeHint || '~').replace(/\/+$/, '');
  const ws = (opts.workspaceRoot || '').replace(/\/+$/, '');
  return {
    bundled: app ? `${app}/skills` : '(appRoot)/skills',
    global: `${home}/.abliterated/skills`,
    workspace: ws ? `${ws}/.ablit/skills` : '<workspaceRoot>/.ablit/skills',
  };
}

export function toCatalogEntries(skills: SkillRecord[]): SkillCatalogEntry[] {
  return skills.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
  }));
}

/** Build SKILL.md text with frontmatter. */
export function formatSkillFile(name: string, description: string, body: string): string {
  const n = String(name || '').trim();
  const d = String(description || '').trim();
  const b = String(body || '').trim();
  if (!n) throw new Error('skill name required');
  if (!d) throw new Error('skill description required');
  if (!b) throw new Error('skill body required');
  return ['---', `name: ${n}`, `description: ${d}`, '---', b, ''].join('\n');
}

export function similarSkillExists(
  skills: SkillCatalogEntry[],
  name: string,
  description: string,
): SkillCatalogEntry | undefined {
  const id = slugifySkillId(name);
  const desc = description.trim().toLowerCase();
  return skills.find((s) => {
    if (s.id === id || slugifySkillId(s.name) === id) return true;
    const sd = (s.description || '').trim().toLowerCase();
    if (!sd || !desc) return false;
    return sd === desc || sd.includes(desc.slice(0, 48)) || desc.includes(sd.slice(0, 48));
  });
}
