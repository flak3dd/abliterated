/**
 * Utility to segment and parse reasoning/thinking streams into digestible structured chunks.
 * Prevents overwhelming the UI with massive walls of raw thought tokens.
 */

export interface ThoughtChunk {
  id: number;
  title: string;
  content: string;
  wordCount: number;
}

/** Sanitize a line or fragment into a clean, concise title. */
function sanitizeTitle(raw: string, maxLen = 48): string {
  const cleaned = raw
    .replace(/^#{1,6}\s*/, '')
    .replace(/^(?:Step\s+\d+|Phase\s+\d+|\d+[.)])\s*[:\-]?\s*/i, '')
    .replace(/^[*_`~]+|[*_`~]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return 'Analyzing';
  if (cleaned.length <= maxLen) return cleaned;
  const cut = cleaned.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + '…';
}

/** Extract a title from the beginning of a chunk. */
function extractChunkTitle(block: string, chunkIndex: number): { title: string; content: string } {
  const lines = block.trim().split('\n');
  const firstLine = lines[0].trim();

  // 1. Markdown heading on first line
  if (/^#{1,4}\s+/.test(firstLine)) {
    const title = sanitizeTitle(firstLine);
    const content = lines.slice(1).join('\n').trim() || firstLine;
    return { title, content };
  }

  // 2. Explicit step marker, e.g. "Step 1: Check configurations"
  if (/^(?:Step\s+\d+|Phase\s+\d+|\d+[.)])\s*[:\-]\s*/i.test(firstLine)) {
    const title = sanitizeTitle(firstLine);
    const content = lines.slice(1).join('\n').trim() || firstLine;
    return { title, content };
  }

  // 3. First sentence or clause
  const sentenceMatch = firstLine.match(/^([^.?!:;\n]{10,60}[.?!:;]?)/);
  if (sentenceMatch && sentenceMatch[1].trim()) {
    const title = sanitizeTitle(sentenceMatch[1].trim());
    return { title, content: block.trim() };
  }

  // Fallback to indexed step
  return {
    title: `Step ${chunkIndex + 1}: ${sanitizeTitle(firstLine)}`,
    content: block.trim(),
  };
}

/**
 * Parses raw reasoning text into an array of structured thought chunks.
 */
export function parseThoughtChunks(raw: string): ThoughtChunk[] {
  const text = (raw || '').trim();
  if (!text) return [];

  // Normalize newlines
  const normalized = text.replace(/\r\n/g, '\n');

  // Split on markdown headings or double newlines that indicate distinct thought blocks
  const rawSections: string[] = [];
  const parts = normalized.split(/\n{2,}/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Check if the part has an internal markdown heading
    const headingParts = trimmed.split(/(?=\n#{1,4}\s+)/);
    for (const hp of headingParts) {
      const hTrimmed = hp.trim();
      if (hTrimmed) {
        rawSections.push(hTrimmed);
      }
    }
  }

  if (rawSections.length === 0) {
    rawSections.push(text);
  }

  // Merge very small fragments (e.g. less than 40 chars without headings) into adjacent chunks
  const mergedSections: string[] = [];
  for (let i = 0; i < rawSections.length; i++) {
    const curr = rawSections[i];
    const isHeading = /^#{1,4}\s+/.test(curr);
    if (!isHeading && curr.length < 50 && mergedSections.length > 0) {
      mergedSections[mergedSections.length - 1] += '\n\n' + curr;
    } else {
      mergedSections.push(curr);
    }
  }

  return mergedSections.map((sec, idx) => {
    const { title, content } = extractChunkTitle(sec, idx);
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    return {
      id: idx + 1,
      title: title || `Step ${idx + 1}`,
      content: content || sec,
      wordCount: words,
    };
  });
}
