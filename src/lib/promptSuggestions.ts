/**
 * Context-aware prompt suggestion engine for Abliterated IDE.
 * Generates exactly 3 relevant, actionable prompt suggestions after each assistant response.
 */

export interface SuggestionContext {
  role?: string;
  mode?: string;
  files?: Array<{ path: string; name?: string }>;
  hasDiff?: boolean;
  hasCode?: boolean;
  hasErrors?: boolean;
  footerOptions?: string[];
  diagnosticsCount?: number;
  /** The user prompt this response answered — used to derive the topic so
   * suggestions reference the same subject instead of generic "this". */
  userPrompt?: string;
}

/**
 * Best-effort subject of a response, so follow-up suggestions name the actual
 * topic (e.g. "promises", "AuthService") rather than a generic "this". Prefers
 * concrete artifacts in the response, then falls back to the user's question.
 */
export function deriveSubject(content: string, userPrompt?: string): string | null {
  const text = content || '';
  // 1. First markdown heading, stripped of question framing.
  const h = text.match(/^#{1,4}\s+(.+?)\s*$/m);
  if (h) {
    const s = h[1]
      .replace(/[?:.]+$/, '')
      .replace(
        /^(what(?:'s| is| are)|how (?:do|does|to)|why (?:do|does|is)|understanding|introduction to|overview of)\s+/i,
        '',
      )
      .replace(/^(a|an|the)\s+/i, '')
      .trim();
    if (s && s.length >= 2 && s.length <= 40) return s;
  }
  // 2. First inline-code token (an API / symbol the answer centers on).
  const code = text.match(/`([A-Za-z_$][\w$.]{1,40})`/);
  if (code) return code[1];
  // 3. A declared identifier INSIDE a fenced code block only (never prose like
  //    "a function bundled together", which would wrongly yield "bundled").
  const fenced = (text.match(/```[\s\S]*?```/g) || []).join('\n');
  if (fenced) {
    const id = fenced.match(/\b(?:function|class|def|interface|type|const|struct|enum)\s+([A-Za-z_$][\w$]{1,40})/);
    if (id) return id[1];
  }
  // 4. Subject lifted from the user's question.
  if (userPrompt) {
    let s = userPrompt
      .trim()
      .replace(/^(please\s+|can you\s+|could you\s+|pls\s+)/i, '')
      .replace(
        /^(explain|describe|what(?:'s| is| are)|how (?:do|does|to)|why (?:do|does|is)|tell me about|show me|give me|help me with|write|implement|create|build|make)\s+/i,
        '',
      )
      .replace(/^(a|an|the)\s+/i, '')
      .replace(/\b(work|works|working|please|for me)\b/gi, '')
      .replace(/\bin\s+[A-Za-z0-9.+#]+\s*$/i, '')
      .replace(/[?.!]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    s = s.split(/\s+/).filter(Boolean).slice(0, 5).join(' ');
    if (s && s.length >= 3 && s.length <= 40) return s;
  }
  return null;
}

/** Sanitize a suggestion string by stripping prefixes, quotes, and trailing punctuation. */
function cleanSuggestion(raw: string): string {
  return raw
    .replace(/^["'`]|["'`]$/g, '')
    .replace(/^\d+[.)]\s*/, '')
    .replace(/^[-*•]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract list items from an embedded suggestion/continuation block if present. */
function extractEmbeddedList(text: string): string[] {
  const headingMatch = text.match(
    /(?:^|\n)(?:\*\*(?:Continue|Suggested Next Steps|Next Steps|Suggestions|Follow-up Prompts):\*\*|###?\s*(?:Continue|Suggested Next Steps|Next Steps|Suggestions|Follow-up Prompts)[^\n]*)\s*([\s\S]*?)(?=(?:\n###|\n---|$))/i,
  );
  if (!headingMatch || !headingMatch[1].trim()) return [];

  const lines = headingMatch[1].split('\n');
  const items: string[] = [];
  for (const line of lines) {
    const m = line.trim().match(/^(?:\d+[.)]|[-*•])\s+(.+)$/);
    if (m && m[1].trim()) {
      const cleaned = cleanSuggestion(m[1]);
      if (cleaned.length >= 3 && !items.includes(cleaned)) {
        items.push(cleaned);
      }
    }
  }
  return items;
}

/** Detect if content looks like a plan or multi-step breakdown. */
function isPlanContent(text: string): boolean {
  return (
    /(?:^|\n)#{1,4}\s*(?:Plan|Steps|Implementation Plan|Proposed Changes)/i.test(text) ||
    /(?:^|\n)(?:Step 1[:.]|1\.\s+\[|\bPhase 1\b)/i.test(text) ||
    (text.includes('1.') && text.includes('2.') && text.includes('3.') && /(?:plan|step|approach|execute)/i.test(text))
  );
}

/** Detect if content mentions or displays an error or diagnostic. */
function isErrorContent(text: string): boolean {
  return (
    /(?:error|exception|fail|failed|failure|rejected|crash|traceback|syntax error|type error)/i.test(text) &&
    !/(?:no error|zero errors|passed|succeeded|0 failing)/i.test(text)
  );
}

/** Detect if content ends with or contains an explicit question asking the user. */
function hasAssistantQuestion(text: string): boolean {
  const lastChunk = text.slice(-400).trim();
  return (
    /\?\s*$/.test(lastChunk) ||
    /(?:would you like|should (?:i|we)|do you want|which (?:approach|option|one)|let me know if)/i.test(lastChunk)
  );
}

/** Extract primary file name mentioned in content or context. */
function detectPrimaryFile(text: string, files?: Array<{ path: string; name?: string }>): string | null {
  if (files && files.length > 0) {
    const first = files[0].name || files[0].path.split('/').pop();
    if (first) return first;
  }
  const match = text.match(/(?:(?:file|in|modify|update|created?|edited?)\s+[`'"]?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]{1,6})[`'"]?)/i);
  if (match && match[1]) {
    const name = match[1].split('/').pop();
    if (name && name.length > 1 && !name.includes('*')) return name;
  }
  return null;
}

/**
 * Returns exactly 3 contextual prompt suggestions for any completed assistant response.
 */
export function getPromptSuggestions(
  content: string,
  context: SuggestionContext = {},
): [string, string, string] {
  const raw = (content || '').trim();

  // 1. If explicit footer options from parseCompletionFooter were provided, use them.
  if (context.footerOptions && context.footerOptions.length >= 3) {
    const o1 = cleanSuggestion(context.footerOptions[0]);
    const o2 = cleanSuggestion(context.footerOptions[1]);
    const o3 = cleanSuggestion(context.footerOptions[2]);
    if (o1 && o2 && o3) {
      return [o1, o2, o3];
    }
  }

  // 2. Check for embedded numbered/bullet list under "Continue" or "Next Steps" headers in markdown.
  const embedded = extractEmbeddedList(raw);
  if (embedded.length >= 3) {
    return [embedded[0], embedded[1], embedded[2]];
  }

  const suggestions: string[] = [];
  const add = (s: string) => {
    const clean = cleanSuggestion(s);
    if (clean && clean.length >= 4 && !suggestions.includes(clean)) {
      suggestions.push(clean);
    }
  };

  // Add any partial embedded items first
  for (const item of embedded) {
    add(item);
  }

  const primaryFile = detectPrimaryFile(raw, context.files);
  const hasDiffs = context.hasDiff ?? (raw.includes('```diff') || raw.includes('--- a/') || raw.includes('+++ b/'));
  const hasCodeBlocks = context.hasCode ?? (raw.includes('```') && !hasDiffs);
  const isPlan = context.mode === 'plan' || isPlanContent(raw);
  const isDebugOrError = context.mode === 'debug' || (context.diagnosticsCount && context.diagnosticsCount > 0) || isErrorContent(raw);
  const asksQuestion = hasAssistantQuestion(raw);

  // Heuristic A: Errors or Debugging
  if (isDebugOrError) {
    if (context.diagnosticsCount && context.diagnosticsCount > 0) {
      add(`Fix the ${context.diagnosticsCount} diagnostic issues and verify the build`);
    } else {
      add('Investigate the root cause and propose a fix');
    }
    add('Show the exact steps to reproduce and verify the issue');
    add('Add defensive checks or error handling to prevent this regression');
  }

  // Heuristic B: Assistant explicitly asked a question or offered choices
  if (asksQuestion && suggestions.length < 3) {
    add('Yes, proceed with the recommended approach');
    add('Explain the tradeoffs and pros/cons before proceeding');
    add('Show a minimal prototype to preview the change');
  }

  // Heuristic C: Plan or Architecture
  if (isPlan && suggestions.length < 3) {
    add('Approve the plan and begin implementing Step 1');
    add('Review the plan for potential risks, edge cases, and performance');
    add('Add automated test verification steps to the plan');
  }

  // Heuristic D: Code Changes / Diffs
  if (hasDiffs && suggestions.length < 3) {
    if (primaryFile) {
      add(`Run tests to verify the changes in ${primaryFile}`);
      add(`Add unit tests covering the new functionality in ${primaryFile}`);
    } else {
      add('Run the test suite to verify the changes');
      add('Add unit test coverage for the modified code');
    }
    add('Review the modified code for edge cases and error handling');
    add('Commit these changes with a conventional commit message');
  }

  // Heuristic E: Code Snippets (non-diff)
  if (hasCodeBlocks && suggestions.length < 3) {
    if (primaryFile) {
      add(`Apply this code to ${primaryFile} and verify`);
    } else {
      add('Apply this code to the project and verify it compiles');
    }
    add('Explain how this implementation works step-by-step');
    add('How would we write unit tests for this implementation?');
  }

  // Heuristic F: File Exploration / Search / Directory Inspection
  if ((raw.includes('grep') || raw.includes('file_outline') || raw.includes('list_dir') || raw.includes('Files found:')) && suggestions.length < 3) {
    if (primaryFile) {
      add(`Examine ${primaryFile} in detail`);
      add(`Search for all usages of the functions defined in ${primaryFile}`);
    } else {
      add('Examine the most relevant file in detail');
      add('Search for all references to these components');
    }
    add('Propose a concrete implementation plan based on these findings');
  }

  // Heuristic G: Ask / chat / conceptual explanation — reference the actual subject.
  if (context.mode === 'ask' || context.mode === 'chat' || context.mode === 'web' || suggestions.length < 3) {
    const subject = deriveSubject(raw, context.userPrompt);
    if (subject) {
      add(`Show a minimal, working code example of ${subject}`);
      add(`What are the common pitfalls and best practices with ${subject}?`);
      add(`How does ${subject} compare to alternative approaches?`);
    } else {
      add('Can you provide a minimal working code example for this?');
      add('How does this approach compare to alternative solutions?');
      add('What are the common pitfalls and best practices to keep in mind?');
    }
  }

  // Fallback defaults to ensure exactly 3 distinct items
  const fallbacks = [
    'Run tests to verify everything is working properly',
    'Review the implementation for edge cases and performance',
    'What are the logical next steps to extend this feature?',
    'Explain the design decisions and architecture behind this',
    'Commit the latest changes with a descriptive message',
  ];

  for (const fallback of fallbacks) {
    if (suggestions.length >= 3) break;
    add(fallback);
  }

  return [suggestions[0], suggestions[1], suggestions[2]];
}
