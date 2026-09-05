/**
 * Lightweight file outline via regex (no AST deps).
 */

const MAX_OUTLINE_LINES = 200;
const MAX_READ_FOR_OUTLINE = 512 * 1024;

export function outlineFromText(relPath, text, maxLines = MAX_OUTLINE_LINES) {
  const path = String(relPath || '');
  const ext = (path.split('.').pop() || '').toLowerCase();
  const lines = String(text ?? '').split(/\r\n|\n|\r/);
  const out = [];

  const push = (lineNo, kind, name) => {
    if (out.length >= maxLines) return false;
    out.push(`${lineNo}:${kind}:${name}`);
    return out.length < maxLines;
  };

  const isTsJs = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext);
  const isPy = ext === 'py';
  const isMd = ['md', 'markdown', 'mdx'].includes(ext);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const n = i + 1;
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (isTsJs) {
      let m;
      if ((m = trimmed.match(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/))) {
        if (!push(n, 'function', m[1])) break;
        continue;
      }
      if ((m = trimmed.match(/^export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/))) {
        if (!push(n, 'class', m[1])) break;
        continue;
      }
      if ((m = trimmed.match(/^export\s+(?:type|interface)\s+([A-Za-z0-9_$]+)/))) {
        if (!push(n, m[0].includes('interface') ? 'interface' : 'type', m[1])) break;
        continue;
      }
      if ((m = trimmed.match(/^export\s+(?:const|let|var|enum)\s+([A-Za-z0-9_$]+)/))) {
        if (!push(n, 'export', m[1])) break;
        continue;
      }
      if ((m = trimmed.match(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)/))) {
        if (!push(n, 'function', m[1])) break;
        continue;
      }
      if ((m = trimmed.match(/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/))) {
        if (!push(n, 'class', m[1])) break;
        continue;
      }
      if ((m = trimmed.match(/^(?:type|interface)\s+([A-Za-z0-9_$]+)/))) {
        if (!push(n, trimmed.startsWith('interface') ? 'interface' : 'type', m[1])) break;
        continue;
      }
      continue;
    }

    if (isPy) {
      let m;
      if ((m = trimmed.match(/^(?:async\s+)?def\s+([A-Za-z0-9_]+)/))) {
        if (!push(n, 'function', m[1])) break;
        continue;
      }
      if ((m = trimmed.match(/^class\s+([A-Za-z0-9_]+)/))) {
        if (!push(n, 'class', m[1])) break;
        continue;
      }
      continue;
    }

    if (isMd) {
      const m = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (m) {
        if (!push(n, `h${m[1].length}`, m[2].trim())) break;
      }
      continue;
    }

    // Generic: headings-ish and top-level defs
    if (/^(?:function|class|def|fn|func|struct|enum|impl|mod|pub)\b/.test(trimmed)) {
      const name = trimmed.replace(/[{(:].*$/, '').trim().slice(0, 80);
      if (!push(n, 'def', name)) break;
    } else if (/^#{1,6}\s+/.test(trimmed) || /^[=-]{3,}$/.test(trimmed)) {
      if (!push(n, 'heading', trimmed.slice(0, 80))) break;
    }
  }

  if (!out.length) {
    return `/* no outline symbols in ${path || 'file'} (${lines.length} lines) */`;
  }
  let content = out.join('\n');
  if (out.length >= maxLines) content += `\n/* truncated at ${maxLines} lines */`;
  return content;
}

export { MAX_OUTLINE_LINES, MAX_READ_FOR_OUTLINE };
