/**
 * Qwen3 / thinking-family models on Featherless (and similar) sometimes
 * degenerate into a wall of `!` (or one repeated punctuation char) instead
 * of an answer. Detect that junk so the stream can abort and retry.
 */

const COLLAPSE_NOTE =
  '(Model degenerated into repeated tokens. Retry the prompt, switch model, or turn Reasoning off.)';

/** Bang/question runs only. Markdown rules (`====`, `****`) are not collapse. */
const REPEAT_RUN = /([!?！？])\1{11,}/u;

const PUNCT_CLASS = /[!?！？]/u;

export const TOKEN_COLLAPSE_REPLY_NOTE = COLLAPSE_NOTE;

function compact(text: string): string {
  return (text || '').replace(/\s+/g, '');
}

function punctRatio(t: string): number {
  if (!t.length) return 0;
  let n = 0;
  for (const ch of t) {
    if (PUNCT_CLASS.test(ch)) n += 1;
  }
  return n / t.length;
}

function dominantCharRatio(t: string): number {
  if (!t.length) return 0;
  const counts = new Map<string, number>();
  let top = 0;
  for (const ch of t) {
    const next = (counts.get(ch) || 0) + 1;
    counts.set(ch, next);
    if (next > top) top = next;
  }
  return top / t.length;
}

/** True when `text` is a punctuation / single-character collapse, not a real answer. */
export function looksLikeTokenCollapse(text: string): boolean {
  const raw = text || '';
  if (!raw.trim()) return false;
  if (REPEAT_RUN.test(raw)) return true;
  const t = compact(raw);
  if (t.length < 32) return false;
  if (punctRatio(t) >= 0.85) return true;
  if (dominantCharRatio(t) >= 0.9) return true;
  return false;
}

/**
 * Abort the live stream: content collapsed, reasoning collapsed with only a
 * stub on the content channel, or a one-letter non-digit stub.
 */
export function shouldAbortTokenCollapse(content: string, reasoning: string): boolean {
  if (looksLikeTokenCollapse(content)) return true;
  if (looksLikeTokenCollapse(reasoning)) {
    const c = (content || '').trim();
    if (!c || looksLikeStubAnswer(c)) return true;
  }
  return false;
}

/** Single letter like "I" — model started a sentence and died. "4" is a real answer. */
export function looksLikeStubAnswer(text: string): boolean {
  const c = (text || '').trim();
  if (c.length !== 1) return false;
  return /[A-Za-z]/u.test(c) && !/\d/.test(c);
}

/** Drop collapsed text; keep a real prefix before a bang run (`4!!!!` → `4`). */
export function stripCollapsedText(text: string): string {
  if (!text) return '';
  const m = text.match(/^(.*?)([!?！]{8,})\s*$/su);
  if (m && m[1].trim()) {
    const prefix = m[1].replace(/[!?！]+$/gu, '').trimEnd();
    if (prefix && !looksLikeTokenCollapse(prefix)) return prefix;
  }
  return looksLikeTokenCollapse(text) ? '' : text;
}
