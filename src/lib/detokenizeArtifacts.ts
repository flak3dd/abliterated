/** Fix common tokenizer spill where models emit GPT-2/BPE piece spellings instead of decoded text. */

const GPT2_SPACE = '\u0120'; // Ġ
const GPT2_NEWLINE = '\u010a'; // Ċ
const SENTENCEPIECE_SPACE = '\u2581'; // ▁

/** True when Ġ/Ċ density looks like undecoded BPE spill (for optional UI badge). */
export function looksLikeTokenSpill(text: string): boolean {
  if (!text) return false;
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x0120 || c === 0x010a) count++;
  }
  if (count === 0) return false;
  if (count >= 3) return true;
  // ≥1 occurrence per 40 characters
  return count * 40 >= text.length;
}

/** Replace GPT-2 / SentencePiece piece glyphs with their decoded characters. */
export function detokenizeArtifacts(text: string): string {
  if (!text) return text;
  // Cheap includes check before any replace work
  if (
    !text.includes(GPT2_SPACE) &&
    !text.includes(GPT2_NEWLINE) &&
    !text.includes(SENTENCEPIECE_SPACE)
  ) {
    return text;
  }
  return text
    .replaceAll(GPT2_SPACE, ' ')
    .replaceAll(GPT2_NEWLINE, '\n')
    .replaceAll(SENTENCEPIECE_SPACE, ' ');
}
