/** Explicit agent response phase for the status monitor. */
export type AgentPhase =
  | 'idle'
  | 'starting'
  | 'reasoning'
  | 'writing'
  | 'tool_plan'
  | 'tool_exec'
  | 'waiting_gate'
  | 'self_deepen'
  | 'integrating_mid_run'
  | 'finishing'
  | 'error'
  | 'stopped';

/** Seconds of reasoning-with-zero-content before amber warning. */
export const REASONING_NO_CONTENT_WARN_SEC = 8;

export type AgentPhaseMeta = {
  toolName?: string;
  deepenPass?: number;
  deepenMax?: number;
  /** Wall-clock when the current busy run started. */
  runStartedAt?: number;
  /** When we first entered reasoning this turn (for no-content warn). */
  reasoningStartedAt?: number;
  /** True once any content delta arrived this turn. */
  hasContent?: boolean;
  /** True once any reasoning delta arrived this turn. */
  hasReasoning?: boolean;
};

const PHASE_ORDER: AgentPhase[] = [
  'starting',
  'reasoning',
  'writing',
  'tool_plan',
  'tool_exec',
  'waiting_gate',
  'self_deepen',
  'integrating_mid_run',
  'finishing',
];

/** Large clear label for the composer monitor. */
export function agentPhaseLabel(phase: AgentPhase, meta: AgentPhaseMeta = {}): string {
  switch (phase) {
    case 'idle':
      return 'Idle';
    case 'starting':
      return 'Starting…';
    case 'reasoning':
      return 'Reasoning…';
    case 'writing':
      return 'Writing reply…';
    case 'tool_plan':
      return 'Planning tools…';
    case 'tool_exec':
      return meta.toolName ? `Running tool: ${meta.toolName}` : 'Running tool…';
    case 'waiting_gate':
      return 'Waiting for Apply/Run';
    case 'self_deepen': {
      const pass = meta.deepenPass ?? 1;
      const max = meta.deepenMax ?? 2;
      return `Self-deepen pass ${pass}/${max}`;
    }
    case 'integrating_mid_run':
      return 'Integrating mid-run…';
    case 'finishing':
      return 'Finishing…';
    case 'error':
      return 'Error';
    case 'stopped':
      return 'Stopped';
    default:
      return 'Busy…';
  }
}

/** Short form for StatusBar / onAgentStatus. */
export function agentPhaseShortLabel(phase: AgentPhase, meta: AgentPhaseMeta = {}): string {
  switch (phase) {
    case 'idle':
      return '';
    case 'starting':
      return 'starting';
    case 'reasoning':
      return 'reasoning';
    case 'writing':
      return 'writing';
    case 'tool_plan':
      return 'tools';
    case 'tool_exec':
      return meta.toolName ? `tool:${meta.toolName}` : 'tool';
    case 'waiting_gate':
      return 'gate';
    case 'self_deepen': {
      const pass = meta.deepenPass ?? 1;
      const max = meta.deepenMax ?? 2;
      return `deepen ${pass}/${max}`;
    }
    case 'integrating_mid_run':
      return 'mid-run';
    case 'finishing':
      return 'finishing';
    case 'error':
      return 'error';
    case 'stopped':
      return 'stopped';
    default:
      return 'busy';
  }
}

/** Index into PHASE_ORDER for step dots (−1 for terminal/idle). */
export function agentPhaseStepIndex(phase: AgentPhase): number {
  const i = PHASE_ORDER.indexOf(phase);
  return i;
}

export function agentPhaseStepCount(): number {
  return PHASE_ORDER.length;
}

export function formatElapsedSec(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

/** One-liner when the model finishes with reasoning but no content tokens. */
export const NO_CONTENT_REASONING_NOTE = '(No content tokens — see reasoning)';

/**
 * Lightly unwrap common thinking wrappers. Prefer leaving real answer text intact.
 */
export function stripThinkingWrappers(reasoning: string): string {
  let text = (reasoning || '').trim();
  if (!text) return '';
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, ' ');
  text = text.replace(/^<think>\s*/i, '').replace(/\s*<\/think>\s*$/i, '');
  text = text.replace(/<\/?think>/gi, ' ');
  text = text.replace(/^\[thinking\]\s*/i, '').replace(/\s*\[\/thinking\]\s*$/i, '');
  text = text.replace(/^Thinking:\s*/i, '');
  return text.trim();
}

/**
 * When the model shipped reasoning but empty content, promote reasoning into the
 * visible answer. Falls back to NO_CONTENT_REASONING_NOTE only if nothing useful remains.
 * Prefer {@link coalesceEmptyContentFromReasoning} (zero-cost) over an API content-channel retry.
 */
export function promoteReasoningToContent(content: string, reasoning?: string): string {
  if ((content || '').trim()) return content;
  const promoted = stripThinkingWrappers(reasoning || '');
  if (promoted) return promoted;
  return NO_CONTENT_REASONING_NOTE;
}

/** Short hard error when coalesce cannot produce a user-facing answer. */
export const MODEL_NO_ANSWER_NOTE = '(Model returned no answer.)';

/**
 * Zero-cost coalesce for R1-style dual channels: empty content + non-empty reasoning →
 * promote stripped reasoning into content (no second completion call).
 * On success, copies reasoning into content for apply/footer but **keeps** the
 * reasoning field so the chat can show an expandable thought panel.
 * On promote failure, leaves reasoning and sets MODEL_NO_ANSWER_NOTE.
 * When `enabled` is false, no-op (reasoning panel only).
 */
export function coalesceEmptyContentFromReasoning(
  assistant: { content: string; reasoning?: string },
  enabled: boolean,
): boolean {
  if ((assistant.content || '').trim()) return false;
  if (!(assistant.reasoning || '').trim()) return false;
  if (!enabled) return false;
  const promoted = stripThinkingWrappers(assistant.reasoning || '');
  if (promoted) {
    assistant.content = promoted;
    return true;
  }
  // Promote yielded nothing useful — leave reasoning; hard error in content.
  assistant.content = MODEL_NO_ANSWER_NOTE;
  return true;
}

/**
 * End-of-stream reasoning channel cleanup.
 * - empty content → copy stripped reasoning into content (keep reasoning for the UI)
 * - live-mirrored content that is a prefix/equal of reasoning is left in place; reasoning stays
 * - else leave both channels
 * Returns true when content or reasoning was mutated.
 */
export function finalizeReasoningChannel(
  assistant: { content: string; reasoning?: string },
  enabled: boolean,
): boolean {
  if (!enabled) return false;
  if ((assistant.content || '').trim()) return false;
  return coalesceEmptyContentFromReasoning(assistant, enabled);
}
