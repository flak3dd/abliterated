/**
 * Single, visible intent classifier for the Abliterated CLI.
 *
 * Folds the CLI's previously-scattered heuristics into ONE decision so a turn's
 * interpretation is explicit (rendered as an intent chip) instead of emerging
 * from independent looksX() prepends firing in unpredictable combinations.
 *
 * Self-contained (no imports) so it unit-tests via a single-file tsc compile.
 * The authoritative build/web signals are INJECTED by the caller (CliScreen
 * passes agentHelpers.looksBuildIntent / looksWebInteractionDirective) so the
 * chip and the runtime gates agree; light local fallbacks keep it usable and
 * testable standalone.
 *
 * Phase 1 (see docs/CLI-ENHANCED-FLOW.md): this classifies the turn and drives
 * the chip + the existing build gate. edit/run/chat/debug all still behave as
 * plain chat (no new behavior yet) — later phases attach per-intent toolsets.
 */

export type CliIntent = 'command' | 'chat' | 'web' | 'build' | 'edit' | 'run' | 'debug';

export interface CliTurnSignals {
  /** From agentHelpers.looksBuildIntent (injected). */
  isBuild?: boolean;
  /** From agentHelpers.looksWebInteractionDirective (injected). */
  isWeb?: boolean;
  /** Whether a workspace root is set (affects build/edit/run applicability). */
  hasWorkspace?: boolean;
}

export interface CliTurnClass {
  intent: CliIntent;
  confidence: 'high' | 'low';
  reason: string;
  signals: {
    isCommand: boolean;
    isDebug: boolean;
    isWeb: boolean;
    isBuild: boolean;
    isEdit: boolean;
    isRun: boolean;
  };
}

// Error / failure phrasing — a debug turn (kept in sync with the old inline
// looksDebug regex in CliScreen so build no longer fires on "build fails …").
const DEBUG_RE =
  /\b(error|fail(?:s|ed|ing)?|bug|crash|exception|traceback|stack\s*trace|debug|why\b|not\s+working|doesn'?t\s+work|broken)\b/i;
// Modify-existing-files phrasing.
const EDIT_RE =
  /\b(edit|modif(?:y|ies|ied)|chang(?:e|es|ed)|updat(?:e|es|ed)|refactor|renam(?:e|es|ed)|rewrite|replace|append|insert|remove|delete)\b/i;
// Start / run / serve phrasing.
const RUN_RE =
  /\b(run|serve|start|launch|exec(?:ute)?|boot|spin\s*up|dev\s+server|npm\s+(?:run|start|test)|yarn\s+\S+|pnpm\s+\S+)\b/i;
// Fallbacks used ONLY when the caller does not inject the authoritative signals.
const BUILD_FALLBACK_RE =
  /\b(build|scaffold|bootstrap|implement|create\s+(?:an?\s+)?(?:app|project|file|module|api|cli|server|component))\b/i;
const WEB_FALLBACK_RE =
  /\b(search\s+(?:the\s+)?web|web\s*search|look\s*up|google|bing|duckduckgo|fetch\s+(?:the\s+)?url|browse)\b|https?:\/\/\S+/i;

/** Slash command, shell escape, or a continuation trigger — routed, not chatted. */
export function isCommandTurn(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (t.startsWith('/') || t.startsWith('$') || t.startsWith('!')) return true;
  const low = t.toLowerCase();
  return low === 'continue' || low === 'c';
}

export function looksDebugTurn(text: string): boolean {
  return DEBUG_RE.test((text || '').trim());
}
export function looksEditTurn(text: string): boolean {
  return EDIT_RE.test((text || '').trim());
}
export function looksRunTurn(text: string): boolean {
  return RUN_RE.test((text || '').trim());
}

/**
 * Classify a CLI turn into exactly one intent. Precedence (first match wins):
 *   command > debug > web > build > edit > run > chat
 * debug outranks build so "build fails, fix it" is a debug turn (matching the
 * prior !looksDebug guard); web outranks build because build-code requests are
 * already excluded from the web signal upstream.
 */
export function classifyCliTurn(text: string, signals: CliTurnSignals = {}): CliTurnClass {
  const t = (text || '').trim();
  const isCommand = isCommandTurn(t);
  const isDebug = t ? looksDebugTurn(t) : false;
  const isWeb = t ? (signals.isWeb ?? WEB_FALLBACK_RE.test(t)) : false;
  const isBuild = t ? (signals.isBuild ?? BUILD_FALLBACK_RE.test(t)) : false;
  const isEdit = t ? looksEditTurn(t) : false;
  const isRun = t ? looksRunTurn(t) : false;
  const sig = { isCommand, isDebug, isWeb, isBuild, isEdit, isRun };

  if (!t) return { intent: 'chat', confidence: 'low', reason: 'empty input', signals: sig };
  if (isCommand)
    return { intent: 'command', confidence: 'high', reason: 'slash / shell / continue prefix', signals: sig };
  if (isDebug)
    return { intent: 'debug', confidence: 'high', reason: 'error / failure / debug phrasing', signals: sig };
  if (isWeb)
    return { intent: 'web', confidence: 'high', reason: 'web lookup / fetch directive', signals: sig };
  if (isBuild)
    return { intent: 'build', confidence: 'high', reason: 'build / scaffold / implement request', signals: sig };
  if (isEdit)
    return { intent: 'edit', confidence: 'high', reason: 'edit / modify existing files', signals: sig };
  if (isRun)
    return { intent: 'run', confidence: 'high', reason: 'run / serve / execute request', signals: sig };
  return { intent: 'chat', confidence: 'low', reason: 'default conversational turn', signals: sig };
}

/** Display metadata for the intent chip (glyph + short label). */
export const CLI_INTENT_META: Record<CliIntent, { label: string; glyph: string }> = {
  command: { label: 'command', glyph: '›' },
  chat: { label: 'chat', glyph: '▷' },
  web: { label: 'web', glyph: '⌕' },
  build: { label: 'build', glyph: '⚒' },
  edit: { label: 'edit', glyph: '✎' },
  run: { label: 'run', glyph: '▶' },
  debug: { label: 'debug', glyph: '⊘' },
};
