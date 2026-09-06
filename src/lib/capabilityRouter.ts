/**
 * Match the operator ask to SKILL.md recipes and connected MCP tools,
 * then auto-inject / auto-attach / one-shot nudge so the agent actually uses them.
 */

import type { SkillCatalogEntry, SkillRecord } from './skills';

export type MissingMcpServer = { name: string; title: string; blurb: string };

function slugifySkillId(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function similarSkillExists(
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

/** Titles/blurbs for unmatched catalog servers (keep names in sync with mcpCatalog). */
const MCP_CATALOG_META: MissingMcpServer[] = [
  { name: 'filesystem', title: 'Filesystem', blurb: 'Read/write/search under the workspace root.' },
  { name: 'memory', title: 'Memory', blurb: 'Local knowledge-graph memory across sessions.' },
  { name: 'sequential-thinking', title: 'Sequential thinking', blurb: 'Structured multi-step reasoning tool.' },
  { name: 'everything', title: 'Everything', blurb: 'Official MCP testbed (tools, resources, prompts).' },
  { name: 'playwright', title: 'Playwright', blurb: 'Browser automation (npx pulls Chromium on first run).' },
  { name: 'fetch', title: 'Fetch', blurb: 'Fetch a URL and convert the page for the model.' },
  { name: 'git', title: 'Git', blurb: 'Status, diff, log, and staging for the workspace repo.' },
  { name: 'time', title: 'Time', blurb: 'Current time and timezone conversion.' },
  { name: 'mempalace', title: 'MemPalace', blurb: 'Local-first verbatim AI memory.' },
];

export type McpToolLike = {
  serverName: string;
  name: string;
  namespaced: string;
  description?: string;
};

export type CapabilityPlan = {
  matchedSkills: SkillRecord[];
  matchedMcp: McpToolLike[];
  extraMcp: McpToolLike[];
  missingCatalog: MissingMcpServer[];
  suggestNewSkill: boolean;
  writeSkillNow: boolean;
  forceTools: boolean;
  systemBlock: string;
};

const STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'have',
  'your',
  'about',
  'into',
  'when',
  'then',
  'than',
  'them',
  'they',
  'will',
  'just',
  'also',
  'only',
  'need',
  'make',
  'using',
  'call',
  'tool',
  'file',
  'want',
  'please',
  'could',
  'would',
  'should',
  'some',
  'more',
  'over',
  'onto',
  'each',
  'been',
  'being',
  'were',
  'what',
  'which',
  'where',
  'there',
  'here',
  'does',
  'done',
  'task',
  'work',
  'code',
  'app',
  'use',
  'how',
  'can',
  'get',
  'set',
  'add',
  'new',
]);

const MCP_INTENT: { name: string; re: RegExp }[] = [
  {
    name: 'playwright',
    re: /\b(playwright|puppeteer|selenium|headless chrome|browser automation|screenshot the page|click the button|fill (the |in )?(the )?form|scrape (the )?(page|site|dom)|navigate to https?:\/\/)\b/i,
  },
  {
    name: 'fetch',
    re: /\b(mcp fetch|html to markdown|fetch (the )?url and convert)\b/i,
  },
  {
    name: 'git',
    re: /\b(git (blame|stash|reflog|show HEAD)|commit history across)\b/i,
  },
  {
    name: 'memory',
    re: /\b(knowledge[- ]graph memory|mcp memory server)\b/i,
  },
  {
    name: 'mempalace',
    re: /\b(mempalace|memory palace)\b/i,
  },
  {
    name: 'time',
    re: /\b(timezone conversion|what time is it in|utc offset)\b/i,
  },
  {
    name: 'sequential-thinking',
    re: /\b(sequential thinking|mcp sequential)\b/i,
  },
  {
    name: 'filesystem',
    re: /\b(mcp filesystem|server-filesystem)\b/i,
  },
];

const EXPLICIT_SKILL_CREATE =
  /\b((create|add|write|save|make|author)\s+(a\s+)?(new\s+)?(skill|playbook|runbook|recipe|sop)\b|\bskill\.md\b|\bwrite_skill\b|\bsuggest_skill\b)/i;
const RECURRING_PROCESS =
  /\b(whenever we|every time we|standard (way|process|procedure) to|from now on when|reusable (process|workflow|recipe|playbook)|save this (as|for) (a |the )?(skill|recipe|playbook))\b/i;

const MAX_SKILL_INJECT = 3;
const MAX_SKILL_BODY = 2_800;
const MAX_MCP_MATCHED = 8;
const MAX_MCP_FULL = 24;

export function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .split(/[^a-z0-9_+.-]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t))
    .slice(0, 48);
}

export function overlapCount(query: string[], haystack: string): number {
  if (!query.length) return 0;
  const hay = (haystack || '').toLowerCase();
  const toks = new Set(tokenize(hay));
  let n = 0;
  for (const t of query) {
    if (toks.has(t) || (t.length >= 5 && hay.includes(t))) n += 1;
  }
  return n;
}

function wholeWord(hay: string, needle: string): boolean {
  const n = (needle || '').trim().toLowerCase();
  if (n.length < 3) return false;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9_-])${esc}(?:$|[^a-z0-9_-])`, 'i').test(hay || '');
}

export function scoreSkillMatch(queryText: string, skill: SkillCatalogEntry): number {
  const q = tokenize(queryText);
  const blob = `${skill.id} ${skill.name} ${skill.description || ''}`;
  let score = overlapCount(q, blob);
  if (wholeWord(queryText, skill.id) || wholeWord(queryText, skill.name)) score += 3;
  return score;
}

export function matchSkills(queryText: string, skills: SkillRecord[], limit = MAX_SKILL_INJECT): SkillRecord[] {
  const q = (queryText || '').trim();
  if (!q || !skills.length) return [];
  const ranked = skills
    .map((s) => ({ s, score: scoreSkillMatch(q, s) }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score);
  const out: SkillRecord[] = [];
  const seen = new Set<string>();
  for (const { s } of ranked) {
    const id = slugifySkillId(s.id) || slugifySkillId(s.name);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

export function catalogIntentHits(queryText: string): MissingMcpServer[] {
  const q = queryText || '';
  const names = new Set<string>();
  for (const row of MCP_INTENT) {
    if (row.re.test(q)) names.add(row.name);
  }
  return MCP_CATALOG_META.filter((e) => names.has(e.name));
}

export function scoreMcpToolMatch(queryText: string, tool: McpToolLike): number {
  const q = tokenize(queryText);
  const blob = `${tool.serverName} ${tool.name} ${tool.description || ''} ${tool.namespaced}`;
  let score = overlapCount(q, blob);
  if (wholeWord(queryText, tool.name) || wholeWord(queryText, tool.serverName)) score += 2;
  const intents = catalogIntentHits(queryText);
  if (intents.some((e) => e.name.toLowerCase() === String(tool.serverName || '').toLowerCase())) {
    score += 3;
  }
  return score;
}

export function matchMcpTools(queryText: string, tools: McpToolLike[], limit = MAX_MCP_MATCHED): McpToolLike[] {
  if (!tools.length) return [];
  const ranked = tools
    .map((t) => ({ t, score: scoreMcpToolMatch(queryText, t) }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score);
  const out: McpToolLike[] = [];
  const seen = new Set<string>();
  for (const { t } of ranked) {
    if (seen.has(t.namespaced)) continue;
    seen.add(t.namespaced);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

export function missingCatalogServers(queryText: string, connected: McpToolLike[]): MissingMcpServer[] {
  const hits = catalogIntentHits(queryText);
  if (!hits.length) return [];
  const connectedNames = new Set(connected.map((t) => String(t.serverName || '').toLowerCase()));
  return hits.filter((e) => !connectedNames.has(e.name.toLowerCase()));
}

export function shouldSuggestNewSkill(
  queryText: string,
  catalog: SkillCatalogEntry[],
  matched: SkillCatalogEntry[],
): boolean {
  const q = (queryText || '').trim();
  if (!q) return false;
  if (matched.length) return false;
  if (!EXPLICIT_SKILL_CREATE.test(q) && !RECURRING_PROCESS.test(q)) return false;
  const nameGuess = q.slice(0, 80);
  if (similarSkillExists(catalog, nameGuess, q.slice(0, 160))) return false;
  return true;
}

export function isExplicitSkillCreate(queryText: string): boolean {
  return EXPLICIT_SKILL_CREATE.test(queryText || '');
}

function clip(text: string, max: number): string {
  const t = (text || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n/* truncated */`;
}

export function formatMatchedSkillsPrompt(skills: SkillRecord[]): string {
  if (!skills.length) return '';
  const parts = [
    '## Matched skills (auto-injected)',
    'These SKILL.md recipes match this request. Follow them this turn. Do not improvise past a matching recipe. Call `read_skill` only if you need a body that is not already below.',
  ];
  for (const s of skills) {
    const body = clip(s.body || '', MAX_SKILL_BODY);
    parts.push(`### ${s.name} (\`${s.id}\`)\n${s.description || ''}\n\n${body}`.trim());
  }
  return parts.join('\n\n');
}

export function formatMatchedMcpPrompt(tools: McpToolLike[]): string {
  if (!tools.length) return '';
  const lines = tools.slice(0, MAX_MCP_MATCHED).map((t) => {
    const desc = (t.description || '').trim().slice(0, 120);
    return `- \`${t.namespaced}\`${desc ? ` — ${desc}` : ''}`;
  });
  return [
    '## Matched MCP tools (auto-attached)',
    'These connected MCP tools match this request. Call them via the API tools channel (`mcp__server__tool`). Do not fake results in markdown. Builtin read_file/web_fetch stay available as fallback.',
    ...lines,
  ].join('\n');
}

export function formatMissingMcpPrompt(missing: MissingMcpServer[]): string {
  if (!missing.length) return '';
  const lines = missing.map((e) => `- **${e.title}** (\`${e.name}\`) — ${e.blurb}. One-click in Settings → MCP.`);
  return [
    '## MCP not connected (would help)',
    'This request matches MCP servers that are not connected. Do not invent their output. Use builtin tools, or ask the operator to enable:',
    ...lines,
  ].join('\n');
}

export function formatSkillCreatePrompt(opts: { writeNow: boolean }): string {
  if (opts.writeNow) {
    return [
      '## New skill (auto-write)',
      'This request is a reusable process with no matching SKILL.md. Call `write_skill` this turn with name, description, and a full markdown body. Auto-accept is on — do not wait for a second confirm.',
    ].join('\n');
  }
  return [
    '## New skill (propose)',
    'This request is a reusable process with no matching SKILL.md. Call `suggest_skill` this turn with name, description, and body. Do not skip. Wait for confirm before `write_skill` unless Auto-accept is on.',
  ].join('\n');
}

export function planCapabilities(opts: {
  queryText: string;
  skills: SkillRecord[];
  mcpTools: McpToolLike[];
  skillsEnabled?: boolean;
  allowAllMcp?: boolean;
  canWriteSkill?: boolean;
  excludeSkillIds?: string[];
}): CapabilityPlan {
  const query = (opts.queryText || '').trim();
  const skillsOn = opts.skillsEnabled !== false;
  const exclude = new Set((opts.excludeSkillIds || []).map((id) => slugifySkillId(id)));

  const matchedSkills = skillsOn
    ? matchSkills(query, opts.skills).filter((s) => !exclude.has(slugifySkillId(s.id) || slugifySkillId(s.name)))
    : [];

  const matchedMcp = matchMcpTools(query, opts.mcpTools);
  const extraMcp = opts.allowAllMcp
    ? preferMatched(opts.mcpTools, matchedMcp, MAX_MCP_FULL)
    : matchedMcp.slice(0, MAX_MCP_MATCHED);

  const missingCatalog = missingCatalogServers(query, opts.mcpTools);
  const catalog = opts.skills.map((s) => ({ id: s.id, name: s.name, description: s.description }));
  const suggestNewSkill = skillsOn && shouldSuggestNewSkill(query, catalog, matchedSkills);
  const writeSkillNow = !!(suggestNewSkill && opts.canWriteSkill && isExplicitSkillCreate(query));
  const forceTools = matchedMcp.length > 0 && catalogIntentHits(query).length > 0;

  const systemBlock = [
    formatMatchedSkillsPrompt(matchedSkills),
    formatMatchedMcpPrompt(matchedMcp),
    formatMissingMcpPrompt(missingCatalog),
    suggestNewSkill ? formatSkillCreatePrompt({ writeNow: writeSkillNow }) : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    matchedSkills,
    matchedMcp,
    extraMcp,
    missingCatalog,
    suggestNewSkill,
    writeSkillNow,
    forceTools,
    systemBlock,
  };
}

function preferMatched(all: McpToolLike[], matched: McpToolLike[], cap: number): McpToolLike[] {
  const seen = new Set<string>();
  const out: McpToolLike[] = [];
  for (const t of [...matched, ...all]) {
    if (seen.has(t.namespaced)) continue;
    seen.add(t.namespaced);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

export function needsMcpFollowNudge(plan: CapabilityPlan, toolsUsed: string[]): boolean {
  if (!plan.matchedMcp.length) return false;
  const used = new Set((toolsUsed || []).map((t) => String(t || '').toLowerCase()));
  if ([...used].some((t) => t.startsWith('mcp__'))) return false;
  const names = new Set(plan.matchedMcp.map((t) => t.namespaced.toLowerCase()));
  return ![...used].some((t) => names.has(t));
}

export function needsSkillCreateNudge(plan: CapabilityPlan, toolsUsed: string[]): boolean {
  if (!plan.suggestNewSkill) return false;
  const used = new Set((toolsUsed || []).map((t) => String(t || '').toLowerCase()));
  if (used.has('suggest_skill') || used.has('write_skill')) return false;
  return true;
}

/** Bodies already injected — no read_skill round-trip required. */
export function needsSkillReadNudge(plan: CapabilityPlan, toolsUsed: string[]): boolean {
  if (!plan.matchedSkills.length) return false;
  if (plan.matchedSkills.some((s) => (s.body || '').trim().length > 40)) return false;
  const used = new Set((toolsUsed || []).map((t) => String(t || '').toLowerCase()));
  return !used.has('read_skill') && !used.has('list_skills');
}

export function buildMcpFollowNudge(plan: CapabilityPlan): string {
  const names = plan.matchedMcp
    .slice(0, 4)
    .map((t) => t.namespaced)
    .join(', ');
  return (
    `Call the matching MCP tool(s) now via the API tools channel: ${names || 'mcp__…'}. ` +
    'Do not paste fake MCP JSON or invented results in markdown.'
  );
}

export function buildSkillCreateNudge(plan: CapabilityPlan): string {
  if (plan.writeSkillNow) {
    return (
      'Propose a skill: no matching SKILL.md covers this reusable process. ' +
      'Call `write_skill` this turn with name, description, and a full markdown body (Auto-accept is on).'
    );
  }
  return (
    'Propose a skill: no matching SKILL.md covers this reusable process. ' +
    'Call `suggest_skill` this turn with name, description, and body. Do not skip.'
  );
}

export function buildSkillReadNudge(plan: CapabilityPlan): string {
  const id = plan.matchedSkills[0]?.id || 'the matching skill';
  return `Use the matching skill: call \`read_skill\` with skill_id "${id}" and follow it this turn. Do not improvise past it.`;
}
