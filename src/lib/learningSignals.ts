/**
 * MemPalace Self-Learning Engine.
 *
 * Deterministic outcome-driven scoring, memory-unit formatting, post-run
 * distillation, and wake-block construction — all integrated through the
 * existing bridgeClient IPC + daemon/mempalace.js CLI adapter.
 *
 * Design spec: docs/MEMPALACE-SELF-LEARNING.md
 */
import type { RunProof } from './harnessGates';
import type { AgentStopReason } from './agentHelpers';
import { mempalaceOpts } from './mempalace';
import type { BridgeClient } from './bridgeClient';

// ---------------------------------------------------------------------------
// Room constants — the cognitive memory taxonomy.
// These are passed as the `room` param to bridge.mempalaceSave / Search.
// ---------------------------------------------------------------------------

/** Verified positive execution recipes and operational heuristics */
export const ROOM_LESSONS = 'lessons';
/** Build breakage patterns, failed tool paths, traps, bug vectors */
export const ROOM_ANTI_PATTERNS = 'anti-patterns';
/** Discovered repository facts, rules, configs, invariants */
export const ROOM_CONVENTIONS = 'conventions';
/** Candidate multi-step workflow templates */
export const ROOM_SKILLS = 'skills';
/** Compacted historical session summaries */
export const ROOM_SESSIONS = 'sessions';

export const LEARNING_ROOMS = [ROOM_LESSONS, ROOM_ANTI_PATTERNS, ROOM_CONVENTIONS, ROOM_SKILLS, ROOM_SESSIONS] as const;

// ---------------------------------------------------------------------------
// Outcome signals — extracted from finishRun() telemetry.
// ---------------------------------------------------------------------------

export interface RunOutcomeSignals {
  threadId: string;
  stopReason: AgentStopReason;
  ms: number;
  turns: number;
  toolsUsed: string[];
  proof: RunProof;
  theaterRetries: number;
  deepenPasses: number;
  provenImprovement: boolean;
  verifyEvidence: boolean;
}

export type LearningClassification =
  | 'exemplary_win'
  | 'nominal_success'
  | 'failed_attempt'
  | 'aborted_noise';

export interface LearningEvaluation {
  score: number; // -1.0 … +1.0
  classification: LearningClassification;
}

// ---------------------------------------------------------------------------
// Score computation — purely deterministic, no LLM needed.
// ---------------------------------------------------------------------------

export function computeLearningScore(signals: RunOutcomeSignals): LearningEvaluation {
  // Aborted or non-actionable runs are noise
  if (signals.stopReason === 'abort' || signals.toolsUsed.length === 0) {
    return { score: 0.0, classification: 'aborted_noise' };
  }

  let score = 0.0;

  // Positive signals
  if (signals.proof.proven) score += 0.4;
  if (signals.proof.verify) score += 0.25;
  if (signals.proof.write) score += 0.1;
  if (signals.proof.explore) score += 0.05;
  if (signals.provenImprovement) score += 0.15;
  if (signals.verifyEvidence) score += 0.05;

  // Penalties
  if (signals.theaterRetries > 0) score -= 0.15 * Math.min(3, signals.theaterRetries);
  if (signals.stopReason === 'error') score -= 0.5;
  if (signals.stopReason === 'loop_detected') score -= 0.3;
  if (signals.stopReason === 'cap') score -= 0.1;

  // Efficiency bonus: clean completion in few turns
  if (signals.stopReason === 'no_tools' && signals.turns <= 3 && signals.proof.proven) {
    score += 0.1;
  }

  score = Math.max(-1.0, Math.min(1.0, score));

  let classification: LearningClassification;
  if (score >= 0.65) classification = 'exemplary_win';
  else if (score >= 0.25) classification = 'nominal_success';
  else if (score <= -0.2) classification = 'failed_attempt';
  else classification = 'aborted_noise';

  return { score, classification };
}

// ---------------------------------------------------------------------------
// Sensitive data redaction — runs before any palace save.
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|token|password|credential|auth[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9/+=_\-.]{16,}["']?/gi,
  /Bearer\s+[A-Za-z0-9_\-.]{20,}/gi,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/g,
  /aws[_-]?secret[_-]?(?:access[_-]?)?key\s*[:=]\s*["']?[A-Za-z0-9/+=]{30,}["']?/gi,
  /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]{20,}?-----END/gi,
  /ghp_[A-Za-z0-9]{36}/g,
  /sk-[A-Za-z0-9]{20,}/g,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const pat of SECRET_PATTERNS) {
    out = out.replace(pat, '[REDACTED]');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Memory unit formatting — standardized YAML-frontmatter + markdown body.
// ---------------------------------------------------------------------------

const MAX_LESSON_CHARS = 4000;
const MAX_ANTIPATTERN_CHARS = 3000;
const MAX_SESSION_CHARS = 2000;

function yamlHeader(fields: Record<string, string | number | boolean | string[]>): string {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map((s) => `"${s}"`).join(', ')}]`);
    } else if (typeof v === 'string' && v.includes('\n')) {
      lines.push(`${k}: |`);
      for (const l of v.split('\n')) lines.push(`  ${l}`);
    } else {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

export function formatLessonMemory(opts: {
  signals: RunOutcomeSignals;
  evaluation: LearningEvaluation;
  userGoal: string;
  assistantSummary: string;
}): string {
  const header = yamlHeader({
    type: 'lesson',
    created: new Date().toISOString(),
    salience: Math.round(opts.evaluation.score * 100) / 100,
    'outcome.write': opts.signals.proof.write,
    'outcome.verify': opts.signals.proof.verify,
    'outcome.proven': opts.signals.proof.proven,
    tools: opts.signals.toolsUsed.slice(0, 8),
    turns: opts.signals.turns,
    ms: opts.signals.ms,
  });
  const body = [
    '### Context & Goal',
    redactSecrets(opts.userGoal.slice(0, 600)),
    '',
    '### Verified Strategy',
    redactSecrets(opts.assistantSummary.slice(0, 2000)),
    '',
    '### Evidence',
    `Completed in ${opts.signals.turns} turn(s), ${opts.signals.ms}ms.`,
    opts.signals.proof.proven ? 'RunProof: proven improvement.' : '',
    opts.signals.proof.verify ? 'Verification evidence present.' : '',
  ]
    .filter(Boolean)
    .join('\n');
  return (header + '\n\n' + body).slice(0, MAX_LESSON_CHARS);
}

export function formatAntiPatternMemory(opts: {
  signals: RunOutcomeSignals;
  evaluation: LearningEvaluation;
  userGoal: string;
  assistantSummary: string;
  errorContext: string;
}): string {
  const header = yamlHeader({
    type: 'anti-pattern',
    created: new Date().toISOString(),
    salience: Math.round(Math.abs(opts.evaluation.score) * 100) / 100,
    stopReason: opts.signals.stopReason,
    theaterRetries: opts.signals.theaterRetries,
    tools: opts.signals.toolsUsed.slice(0, 8),
  });
  const body = [
    '### Context & Goal',
    redactSecrets(opts.userGoal.slice(0, 400)),
    '',
    '### Failure Symptom',
    `Stop reason: ${opts.signals.stopReason}.`,
    opts.signals.theaterRetries > 0 ? `Theater retries: ${opts.signals.theaterRetries}.` : '',
    !opts.signals.proof.verify ? 'No verification evidence found.' : '',
    '',
    '### Error Context',
    redactSecrets(opts.errorContext.slice(0, 800)),
    '',
    '### Mitigation',
    'DO NOT REPEAT this pattern. Consider alternative tools or breaking the task into smaller steps.',
  ]
    .filter(Boolean)
    .join('\n');
  return (header + '\n\n' + body).slice(0, MAX_ANTIPATTERN_CHARS);
}

export function formatCompactSessionSummary(opts: {
  signals: RunOutcomeSignals;
  evaluation: LearningEvaluation;
  userGoal: string;
  model?: string;
  threadTitle?: string;
}): string {
  const lines = [
    `Session ${new Date().toISOString()} [${opts.evaluation.classification}] score=${opts.evaluation.score.toFixed(2)}`,
    opts.threadTitle ? `Thread: ${opts.threadTitle}` : '',
    opts.model ? `Model: ${opts.model}` : '',
    `Turns: ${opts.signals.turns}, ms: ${opts.signals.ms}, tools: ${opts.signals.toolsUsed.slice(0, 5).join(',')}`,
    `Stop: ${opts.signals.stopReason}, proven: ${opts.signals.proof.proven}, verify: ${opts.signals.proof.verify}`,
    '',
    '## Goal',
    redactSecrets(opts.userGoal.slice(0, 600)),
  ];
  return lines
    .filter((l, i) => l !== '' || i === 0)
    .join('\n')
    .slice(0, MAX_SESSION_CHARS);
}

// ---------------------------------------------------------------------------
// Wake block builder — multi-room retrieval-gated prompt injection.
// ---------------------------------------------------------------------------

const WAKE_TOKEN_BUDGET = 2400; // ~chars, matching formatWakePrompt in daemon

export function formatSelfLearningWakeBlock(opts: {
  baseWake: string;
  lessons: string;
  antiPatterns: string;
}): string {
  const sections: string[] = [];

  // Always include the existing wake-up (conventions/L0)
  if (opts.baseWake) {
    sections.push(opts.baseWake);
  }

  // Inject learned lessons
  if (opts.lessons && opts.lessons !== '(no results)') {
    sections.push(
      '### Learned Operational Heuristics (Proven Winning Strategies)',
      opts.lessons.slice(0, 800),
    );
  }

  // Inject anti-pattern warnings
  if (opts.antiPatterns && opts.antiPatterns !== '(no results)') {
    sections.push(
      '### Known Anti-Patterns & Traps (DO NOT REPEAT)',
      opts.antiPatterns.slice(0, 600),
    );
  }

  const combined = sections.join('\n\n');
  return combined.slice(0, WAKE_TOKEN_BUDGET);
}

// ---------------------------------------------------------------------------
// Post-run learning scheduler — the main integration point.
// Called non-blockingly from finishRun() / jobRunner completion.
// ---------------------------------------------------------------------------

export type LearningSettings = {
  mempalaceEnabled?: boolean;
  mempalaceSelfLearning?: boolean;
  mempalaceAntiPatternMining?: boolean;
  mempalacePalacePath?: string;
  mempalaceWing?: string;
};

export async function schedulePostRunLearning(opts: {
  signals: RunOutcomeSignals;
  userGoal: string;
  assistantSummary: string;
  errorContext: string;
  model?: string;
  threadTitle?: string;
  settings: LearningSettings;
  workspaceRoot: string;
  bridge: BridgeClient;
}): Promise<void> {
  const { signals, settings, bridge: br } = opts;

  // Gate: self-learning must be enabled
  if (settings.mempalaceEnabled === false) return;
  if (settings.mempalaceSelfLearning === false) return;
  if (!br.connected) return;

  const evaluation = computeLearningScore(signals);
  if (evaluation.classification === 'aborted_noise') return;

  const palaceOpts = mempalaceOpts(
    { mempalacePalacePath: settings.mempalacePalacePath || '', mempalaceWing: settings.mempalaceWing || '' },
    opts.workspaceRoot,
  );

  try {
    // Exemplary wins → distill positive lesson
    if (evaluation.classification === 'exemplary_win') {
      const lesson = formatLessonMemory({
        signals,
        evaluation,
        userGoal: opts.userGoal,
        assistantSummary: opts.assistantSummary,
      });
      await br.mempalaceSave(lesson, { ...palaceOpts, room: ROOM_LESSONS });
    }

    // Failed attempts → mine anti-pattern (if enabled)
    if (
      evaluation.classification === 'failed_attempt' &&
      settings.mempalaceAntiPatternMining !== false
    ) {
      const antiPattern = formatAntiPatternMemory({
        signals,
        evaluation,
        userGoal: opts.userGoal,
        assistantSummary: opts.assistantSummary,
        errorContext: opts.errorContext,
      });
      await br.mempalaceSave(antiPattern, { ...palaceOpts, room: ROOM_ANTI_PATTERNS });
    }

    // Always save a compact session ledger (replaces the old raw transcript dump)
    const compactSummary = formatCompactSessionSummary({
      signals,
      evaluation,
      userGoal: opts.userGoal,
      model: opts.model,
      threadTitle: opts.threadTitle,
    });
    await br.mempalaceSave(compactSummary, { ...palaceOpts, room: ROOM_SESSIONS });
  } catch {
    // Palace is optional — never fail the run
  }
}

// ---------------------------------------------------------------------------
// Enhanced wake-up — augment the standard wake block with learned lessons
// and anti-pattern warnings from their dedicated rooms.
// ---------------------------------------------------------------------------

export async function enhancedMempalaceWake(opts: {
  settings: LearningSettings;
  workspaceRoot: string;
  bridge: BridgeClient;
  baseWake: string;
}): Promise<string> {
  const { settings, bridge: br } = opts;

  if (settings.mempalaceEnabled === false || !br.connected) {
    return opts.baseWake;
  }

  // If self-learning is off, just return the standard wake
  if (settings.mempalaceSelfLearning === false) {
    return opts.baseWake;
  }

  const palaceOpts = mempalaceOpts(
    { mempalacePalacePath: settings.mempalacePalacePath || '', mempalaceWing: settings.mempalaceWing || '' },
    opts.workspaceRoot,
  );

  let lessons = '';
  let antiPatterns = '';

  try {
    lessons = await br.mempalaceSearch('proven strategies lessons', {
      ...palaceOpts,
      room: ROOM_LESSONS,
      results: 3,
    });
  } catch {
    // ignore
  }

  try {
    antiPatterns = await br.mempalaceSearch('failures traps anti-patterns', {
      ...palaceOpts,
      room: ROOM_ANTI_PATTERNS,
      results: 2,
    });
  } catch {
    // ignore
  }

  return formatSelfLearningWakeBlock({
    baseWake: opts.baseWake,
    lessons,
    antiPatterns,
  });
}
