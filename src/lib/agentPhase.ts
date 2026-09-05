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
