/**
 * Featherless Abliteration-grade agent path — large Qwen only.
 * Dense >=32B OR MoE activated >=16B; REJECT all A3B.
 * Exception: Qwen3.8-27B abliterated/heretic/uncensored dense forks.
 * @see docs/FEATHERLESS-QWEN-BUILD.md
 */

export const DEFAULT_FEATHERLESS_MODEL = "Qwen/Qwen3-32B";
export const LEGACY_FEATHERLESS_MODEL = "Qwen/Qwen2.5-7B-Instruct";
export const FEATHERLESS_MIN_CONTEXT = 16384;

/** First-class Featherless picker: abliterated 32B Qwen (and QwQ / R1-Distill-Qwen). */
export const PINNED_FEATHERLESS_MODELS: readonly { id: string; label: string }[] = [
  { id: 'huihui-ai/Qwen3-32B-abliterated', label: 'Qwen3-32B · huihui' },
  { id: 'huihui-ai/Qwen2.5-32B-Instruct-abliterated', label: 'Qwen2.5-32B Instruct · huihui' },
  { id: 'sci4ai/Qwen2.5-32B-Instruct-Abliterated', label: 'Qwen2.5-32B Instruct · sci4ai' },
  { id: 'TobiasLogic/Qwen2.5-Coder-32B-abliterated', label: 'Qwen2.5-Coder-32B · TobiasLogic' },
  { id: 'huihui-ai/DeepSeek-R1-Distill-Qwen-32B-abliterated', label: 'R1-Distill-Qwen-32B · huihui' },
  { id: 'zetasepic/Qwen2.5-32B-Instruct-abliterated-v2', label: 'Qwen2.5-32B Instruct v2 · zetasepic' },
  { id: 'roslein/Qwen3-32B-abliterated', label: 'Qwen3-32B · roslein' },
  { id: 'huihui-ai/QwQ-32B-abliterated', label: 'QwQ-32B · huihui' },
];

const PINNED_FEATHERLESS_IDS = new Set(PINNED_FEATHERLESS_MODELS.map((m) => m.id));

export function isPinnedFeatherlessModel(modelId: string): boolean {
  return PINNED_FEATHERLESS_IDS.has((modelId || '').trim());
}

const UNCENSORED_RE = /abliterat|obliterat|heretic|uncensored/i;
const FAMILY_RE = /qwen2[._-]?5|qwen3(?:\.[568])?|qwq/i;


export type QwenSizeInfo = {
  denseB: number | null;
  activatedB: number | null;
  isA3B: boolean;
};

/** Parse dense Nb and MoE A{n}B activated expert count from a model id. */
export function parseQwenSizeInfo(modelId: string): QwenSizeInfo {
  const id = modelId || "";
  let activatedB: number | null = null;
  const aMatch = id.match(/A(\d+(?:\.\d+)?)[Bb](?![a-zA-Z])/);
  if (aMatch) {
    const n = Number(aMatch[1]);
    if (Number.isFinite(n)) activatedB = n;
  }
  let denseB: number | null = null;
  for (const m of id.matchAll(/(\d+(?:\.\d+)?)[Bb](?![a-zA-Z])/g)) {
    const start = m.index ?? 0;
    const prev = id[start - 1] || "";
    if (prev === "A" || prev === "a") continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && (denseB == null || n > denseB)) denseB = n;
  }
  const isA3B = activatedB === 3;
  return { denseB, activatedB, isA3B };
}

export function isFeatherlessQwenFamily(modelId: string): boolean {
  const s = (modelId || "").toLowerCase();
  if (/qwq/.test(s)) return true;
  if (!s.includes("qwen")) return false;
  if (/qwen1(?:\.5)?(?!\d)/.test(s) && !/qwen2|qwen3/.test(s)) return false;
  return FAMILY_RE.test(s);
}

export function isFeatherlessUncensoredVariant(modelId: string): boolean {
  return UNCENSORED_RE.test(modelId || "");
}

/** Explicit allowlist exception: dense Qwen3.8-27B abliterated/heretic/uncensored forks. */
export function isQwen38Abliterated27B(modelId: string): boolean {
  const id = modelId || "";
  if (!isFeatherlessQwenFamily(id)) return false;
  if (!/qwen3\.8/i.test(id)) return false;
  if (!/27\s*B/i.test(id)) return false;
  if (!UNCENSORED_RE.test(id)) return false;
  const info = parseQwenSizeInfo(id);
  if (info.isA3B) return false;
  if (info.activatedB != null && info.activatedB < 16 && info.activatedB !== 27) {
    // A3B already rejected; other tiny activated tags reject
    if (info.activatedB <= 3) return false;
  }
  // Dense ~27B (allow 26-28 slop) or labeled 27B without conflicting smaller dense
  if (info.denseB != null && (info.denseB < 26 || info.denseB > 28)) return false;
  return true;
}

/**
 * Large Qwen agent gate (locked):
 * - family Qwen2.5 / Qwen3 / Qwen3.5 / Qwen3.6 / Qwen3.8 (+ Coder/VL)
 * - dense >= 32 OR activated >= 16
 * - REJECT all A3B
 * - EXCEPTION: isQwen38Abliterated27B
 */
export function isLargeQwenAgentModel(modelId: string): boolean {
  const id = (modelId || "").trim();
  if (!id) return false;
  if (isPinnedFeatherlessModel(id)) return true;
  if (!isFeatherlessQwenFamily(id)) return false;
  if (isQwen38Abliterated27B(id)) return true;
  const info = parseQwenSizeInfo(id);
  if (info.isA3B) return false;
  if (info.activatedB != null && info.activatedB >= 16) return true;
  if (info.denseB != null && info.denseB >= 32) return true;
  return false;
}

export const isEligibleFeatherlessQwen = isLargeQwenAgentModel;
export const isAllowedFeatherlessModel = isLargeQwenAgentModel;

export function filterFeatherlessQwenModels<T extends { id: string }>(models: T[]): T[] {
  return sortFeatherlessQwenModels(models.filter((m) => isLargeQwenAgentModel(m.id)));
}

/** Catalog rows plus pinned 32B abliterated options (even if the current API page omitted them). */
export function mergePinnedFeatherlessModels<T extends { id: string }>(models: T[]): T[] {
  const byId = new Map(models.map((m) => [m.id, m]));
  const out: T[] = [];
  for (const p of PINNED_FEATHERLESS_MODELS) {
    out.push(byId.get(p.id) ?? ({ id: p.id } as T));
    byId.delete(p.id);
  }
  return [...out, ...sortFeatherlessQwenModels([...byId.values()])];
}

export function sortFeatherlessQwenModels<T extends { id: string }>(models: T[]): T[] {
  return models.slice().sort((a, b) => {
    const ap = isPinnedFeatherlessModel(a.id) ? 1 : 0;
    const bp = isPinnedFeatherlessModel(b.id) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const au = isFeatherlessUncensoredVariant(a.id) ? 1 : 0;
    const bu = isFeatherlessUncensoredVariant(b.id) ? 1 : 0;
    if (au !== bu) return bu - au;
    const as = parseQwenSizeInfo(a.id);
    const bs = parseQwenSizeInfo(b.id);
    const aScore = as.activatedB != null && as.activatedB >= 16 ? as.activatedB : as.denseB || 0;
    const bScore = bs.activatedB != null && bs.activatedB >= 16 ? bs.activatedB : bs.denseB || 0;
    if (aScore !== bScore) return bScore - aScore;
    return a.id.localeCompare(b.id, undefined, { sensitivity: "base" });
  });
}

export type FeatherlessMigrateResult = {
  model: string;
  migrated: boolean;
  patch?: { reasoning: "max"; coalesceReasoningToContent: true };
};

export function resolveFeatherlessModelId(stored?: string | null): string {
  return migrateFeatherlessModel(stored).model;
}

export function migrateFeatherlessModel(stored?: string | null): FeatherlessMigrateResult {
  const m = (stored || "").trim();
  if (!m || m === LEGACY_FEATHERLESS_MODEL || !isLargeQwenAgentModel(m)) {
    return {
      model: DEFAULT_FEATHERLESS_MODEL,
      migrated: !m || m !== DEFAULT_FEATHERLESS_MODEL,
      patch: { reasoning: "max", coalesceReasoningToContent: true },
    };
  }
  return { model: m, migrated: false };
}

export function abliterationGradeFeatherlessPatch(): {
  inferenceProvider: "featherless";
  featherlessEnabled: true;
  featherlessModel: string;
  featherlessBaseUrl: string;
  reasoning: "max";
  coalesceReasoningToContent: true;
  skillsEnabled: true;
} {
  return {
    inferenceProvider: "featherless",
    featherlessEnabled: true,
    featherlessModel: DEFAULT_FEATHERLESS_MODEL,
    featherlessBaseUrl: "https://api.featherless.ai/v1",
    reasoning: "max",
    coalesceReasoningToContent: true,
    skillsEnabled: true,
  };
}

export const FEATHERLESS_EMPTY_STATE =
  "No large Qwen models matched the filter (dense ≥32B or activated ≥16B; A3B rejected; Qwen3.8-27B abliterated exception). Apply the Abliteration-grade preset or pick Qwen/Qwen3-32B.";

/** Effective context for eligible Featherless Qwen — ignore tiny model cards. */
export function featherlessEligibleContext(cardContext: number | undefined, fallback = 32768): number {
  const n = typeof cardContext === "number" && cardContext > 0 ? cardContext : fallback;
  if (n < FEATHERLESS_MIN_CONTEXT) return Math.max(fallback, FEATHERLESS_MIN_CONTEXT);
  return n;
}
