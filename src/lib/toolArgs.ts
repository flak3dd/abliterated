/** Parse OpenAI tool-call argument JSON, recovering path/content from truncated blobs. */

const PATH_RE = /"(?:path|file|target|file_path|filename)"\s*:\s*"((?:\\.|[^"\\])*)"/i;
const CONTENT_OPEN_RE = /"(?:content|text|body|contents)"\s*:\s*"/i;

function unescapeJsonString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function sliceJsonString(raw: string, openAt: number): string {
  let esc = false;
  for (let i = openAt; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\') {
      esc = true;
      continue;
    }
    if (ch === '"') return raw.slice(openAt, i);
  }
  return raw.slice(openAt).replace(/"\s*}\s*$/, '');
}

/** JSON.parse first; on failure, pull path + content out of a partial object. */
export function parseToolCallArguments(raw: string): Record<string, unknown> {
  const s = String(raw || '').trim();
  if (!s) return {};
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* recover */
  }
  const out: Record<string, unknown> = { raw: s };
  const pathM = PATH_RE.exec(s);
  if (pathM) {
    const p = unescapeJsonString(pathM[1]);
    out.path = p;
    out.file = p;
  }
  const open = CONTENT_OPEN_RE.exec(s);
  if (open && open.index != null) {
    out.content = unescapeJsonString(sliceJsonString(s, open.index + open[0].length));
  }
  return out;
}
