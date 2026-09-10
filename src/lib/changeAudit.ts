import { ChangeSummary } from '../types';
import { parseCompletionFooter, ParsedCompletionFooter } from './completionFooter';

const WRITE_TOOLS = new Set([
  'write_file',
  'apply_patch',
  'search_replace',
  'edit_file',
  'str_replace',
  'patch_file',
]);

export interface ChangeAuditParams {
  content: string;
  toolCalls?: Array<{ name: string; arguments?: Record<string, unknown> }>;
  grokResults?: Array<{ file: string; status?: string }>;
  filesWritten?: string[];
  userText?: string;
}

export interface ChangeAuditResult {
  hasModifications: boolean;
  actualModifiedFiles: string[];
  claimedFiles: string[];
  unverifiedFiles: string[];
  summaryItems: string[];
  verificationItems: string[];
  isVerified: boolean;
  needsVerificationNudge: boolean;
  nudgePrompt?: string;
  changeSummary: ChangeSummary;
  footer: ParsedCompletionFooter | null;
}

function normalizePath(raw: string): string {
  return (raw || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

/** Extract written or modified files from tool calls, grok diffs, and explicit lists. */
export function extractModifiedFiles(params: {
  toolCalls?: Array<{ name: string; arguments?: Record<string, unknown> }>;
  grokResults?: Array<{ file: string; status?: string }>;
  filesWritten?: string[];
}): string[] {
  const set = new Set<string>();

  for (const f of params.filesWritten || []) {
    const norm = normalizePath(f);
    if (norm) set.add(norm);
  }

  for (const g of params.grokResults || []) {
    if (g.file && (g.status === 'ok' || g.status === 'pending' || !g.status)) {
      const norm = normalizePath(g.file);
      if (norm) set.add(norm);
    }
  }

  for (const tc of params.toolCalls || []) {
    const name = String(tc.name || '').toLowerCase();
    if (!WRITE_TOOLS.has(name)) continue;
    const args = tc.arguments || {};
    const candidate = [args.path, args.file, args.target, args.file_path, args.filename].find(
      (v) => typeof v === 'string' && (v as string).trim(),
    );
    if (typeof candidate === 'string') {
      const norm = normalizePath(candidate);
      if (norm) set.add(norm);
    }
  }

  return Array.from(set);
}

/** Find files mentioned in markdown text or code blocks. */
export function extractReferencedFiles(text: string, knownFiles?: string[]): string[] {
  const referenced = new Set<string>();
  if (!text) return [];

  // Match markdown inline code `path/to/file.ext` or path-like strings
  const codeMatches = text.match(/`([^`\n]+)`/g) || [];
  for (const cm of codeMatches) {
    const inner = cm.slice(1, -1).trim();
    if (/\.[a-zA-Z0-9_-]{1,10}$/.test(inner) && !/\s/.test(inner)) {
      referenced.add(normalizePath(inner));
    }
  }

  // Also check if any known files appear verbatim in text
  if (knownFiles) {
    for (const kf of knownFiles) {
      const norm = normalizePath(kf);
      if (text.includes(norm) || text.includes(norm.split('/').pop() || '')) {
        referenced.add(norm);
      }
    }
  }

  return Array.from(referenced);
}

/**
 * Builds the verification & change summary nudge when an agent modifies code
 * but fails to self-verify or provide an itemized change summary.
 */
export function buildVerifySummaryNudge(opts?: {
  unverifiedFiles?: string[];
  missingFooter?: boolean;
}): string {
  const unverified = (opts?.unverifiedFiles || []).filter(Boolean);
  const fileNotice = unverified.length
    ? `\nModified files requiring verification: ${unverified.slice(0, 5).join(', ')}`
    : '';

  return (
    `Verification and Change Summary required before completing this turn.${fileNotice}\n\n` +
    `Please conclude your response with a concise summary of changes and an active self-verification checklist ` +
    `where you confirm each completed item with concrete evidence:\n\n` +
    `---\n` +
    `**Done:** <brief summary of what was accomplished>\n` +
    `**Changes:**\n` +
    `- <itemized changes made to files / code>\n` +
    `**Verified:**\n` +
    `- [x] <item>: <concrete verification evidence, test result, or inspected artifact>\n` +
    `**Continue:**\n` +
    `1. <next action 1>\n` +
    `2. <next action 2>\n` +
    `3. <next action 3>`
  );
}

/**
 * Audits an agent turn's claimed changes against actual filesystem mutations,
 * verifying that the agent actively checked and verified its work.
 */
export function auditTurnChanges(params: ChangeAuditParams): ChangeAuditResult {
  const actualModifiedFiles = extractModifiedFiles({
    toolCalls: params.toolCalls,
    grokResults: params.grokResults,
    filesWritten: params.filesWritten,
  });

  const hasModifications = actualModifiedFiles.length > 0;
  const footer = parseCompletionFooter(params.content);

  // Extract change summary items and verification items
  const summaryItems: string[] = [];
  const verificationItems: string[] = [];

  if (footer) {
    if (footer.changes && footer.changes.length) {
      summaryItems.push(...footer.changes);
    } else if (footer.summary) {
      summaryItems.push(footer.summary);
    }
    if (footer.verifications && footer.verifications.length) {
      verificationItems.push(...footer.verifications);
    }
  } else {
    // Fallback: parse inline checkmarks or verification section if footer was not strictly formatted
    const verifyMatch = params.content.match(
      /(?:^|\n)(?:\*\*(?:Verified|Verification):\*\*|###?\s*(?:Verified|Verification)[^\n]*)\s*([\s\S]*?)(?=(?:\n\*\*|\n###|$))/i,
    );
    if (verifyMatch) {
      for (const line of verifyMatch[1].split('\n')) {
        const bm = line.trim().match(/^[-*]\s*(?:\[[xX ]\]\s*)?(.+)$/);
        if (bm && bm[1].trim()) verificationItems.push(bm[1].trim());
      }
    }
  }

  // Identify claimed files
  const textToScan = [
    summaryItems.join('\n'),
    verificationItems.join('\n'),
    footer?.summary || '',
  ].join('\n');
  const claimedFiles = extractReferencedFiles(textToScan, actualModifiedFiles);

  // Unverified files: actual modified files not mentioned in summary/verifications
  const unverifiedFiles: string[] = [];
  if (hasModifications) {
    for (const f of actualModifiedFiles) {
      const base = f.split('/').pop() || f;
      const mentioned = claimedFiles.includes(f) || textToScan.includes(f) || textToScan.includes(base);
      if (!mentioned) {
        unverifiedFiles.push(f);
      }
    }
  }

  // Self-verification validity:
  // Must have at least one verification item confirming work when files are modified
  const isVerified = hasModifications
    ? verificationItems.length > 0
    : true;

  const needsVerificationNudge = hasModifications && (!isVerified || summaryItems.length === 0);

  const fileEntries = actualModifiedFiles.map((path) => {
    const grok = params.grokResults?.find((g) => normalizePath(g.file) === path);
    return {
      path,
      status: grok?.status || 'modified',
    };
  });

  const changeSummary: ChangeSummary = {
    files: fileEntries,
    changes: summaryItems,
    verifications: verificationItems,
    verified: isVerified,
  };

  return {
    hasModifications,
    actualModifiedFiles,
    claimedFiles,
    unverifiedFiles,
    summaryItems,
    verificationItems,
    isVerified,
    needsVerificationNudge,
    nudgePrompt: needsVerificationNudge
      ? buildVerifySummaryNudge({ unverifiedFiles, missingFooter: !footer })
      : undefined,
    changeSummary,
    footer,
  };
}
