import type { SkillRecord } from './skills';

export type ProjectMemoryFile = { path: string; text: string };

const MAX_FILE_CHARS = 8_000;
const MAX_TOTAL_CHARS = 16_000;
const MAX_SKILL_BODY = 3_000;
const MAX_WORKSPACE_SKILLS = 6;

export function clipText(text: string, max: number): string {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n/* truncated */`;
}

/** System-prompt block for AGENTS.md / CLAUDE.md / .cursorrules / .ablit rules. */
export function formatProjectMemoryPrompt(files: ProjectMemoryFile[]): string {
  if (!files.length) return '';
  const parts: string[] = [
    '## Project conventions (auto-loaded)',
    'Workspace rules for this repo. Follow them over generic defaults. Do not echo this block unless asked.',
  ];
  let used = 0;
  for (const f of files) {
    const body = clipText(f.text, MAX_FILE_CHARS);
    if (!body) continue;
    if (used + body.length > MAX_TOTAL_CHARS) break;
    parts.push(`### ${f.path}\n${body}`);
    used += body.length;
  }
  return parts.length > 2 ? parts.join('\n\n') : '';
}

/** Full bodies of workspace `.ablit/skills` so the agent can follow them without a round-trip. */
export function formatAutoLoadedSkillsPrompt(skills: SkillRecord[]): string {
  const workspace = skills.filter((s) => (s.source || '') === 'workspace').slice(0, MAX_WORKSPACE_SKILLS);
  if (!workspace.length) return '';
  const parts: string[] = [
    '## Workspace skills (auto-loaded)',
    'These SKILL.md recipes live in `.ablit/skills` and are already in context. Follow them when they match. Call `read_skill` only if you need a bundled/user skill not listed here.',
  ];
  for (const s of workspace) {
    const body = clipText(s.body || '', MAX_SKILL_BODY);
    parts.push(`### ${s.name} (\`${s.id}\`)\n${s.description || ''}\n\n${body}`.trim());
  }
  return parts.join('\n\n');
}
