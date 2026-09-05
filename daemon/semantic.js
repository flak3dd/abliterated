/**
 * Lexical + path scoring workspace search (v1 "semantic_search").
 * No embedding deps — ranked by hit density and path match.
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { isInsideRoot, matchGlob, skipSearchName, toRel, walkFiles } from './search.js';

const MAX_READ_BYTES = 1024 * 1024;
const MAX_SNIPPETS = 15;
const MAX_LINE = 160;

const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'are', 'was', 'were',
  'will', 'would', 'could', 'should', 'about', 'when', 'what', 'where', 'which',
  'who', 'how', 'why', 'please', 'just', 'like', 'want', 'need', 'make', 'file',
  'code', 'read', 'write', 'edit', 'fix', 'add', 'use', 'using', 'not', 'any',
  'all', 'can', 'you', 'me', 'my', 'our', 'a', 'an', 'to', 'of', 'in', 'on', 'at',
  'by', 'or', 'as', 'is', 'be', 'do',
]);

function isBinaryBuf(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export function tokenizeQuery(query) {
  const words = String(query || '').match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) || [];
  const out = [];
  const seen = new Set();
  for (const w of words) {
    const lower = w.toLowerCase();
    if (STOP.has(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(lower);
  }
  return out;
}

function pathBonus(rel, tokens) {
  const lower = rel.toLowerCase();
  let bonus = 0;
  const base = lower.split('/').pop() || '';
  for (const t of tokens) {
    if (lower.includes(t)) bonus += 8;
    if (base.includes(t)) bonus += 12;
  }
  return bonus;
}

/**
 * Score and return top snippets: path:line:excerpt
 * @param {string} root
 * @param {string} query
 * @param {{ path?: string, glob?: string, maxSnippets?: number }} opts
 */
export async function semanticSearch(root, query, opts = {}) {
  const tokens = tokenizeQuery(query);
  if (!tokens.length) return 'no matches (empty query tokens)';

  const startRel = String(opts.path || '.').trim() || '.';
  const startAbs = path.resolve(root, startRel);
  if (!isInsideRoot(root, startAbs)) throw new Error('path escapes workspace root');

  const globPat = opts.glob != null && String(opts.glob).trim() ? String(opts.glob).trim() : '';
  let cap = Number(opts.maxSnippets);
  if (!Number.isFinite(cap) || cap <= 0) cap = MAX_SNIPPETS;
  cap = Math.min(50, Math.floor(cap));

  /** @type {Map<string, { score: number, snippets: Array<{ line: number, text: string, hits: number }> }>} */
  const byFile = new Map();

  const considerFile = async (fileAbs) => {
    const rel = toRel(root, fileAbs);
    if (globPat && !matchGlob(globPat, rel)) return false;
    let st;
    try {
      st = await stat(fileAbs);
    } catch {
      return false;
    }
    if (!st.isFile() || st.size > MAX_READ_BYTES) return false;
    let buf;
    try {
      buf = await readFile(fileAbs);
    } catch {
      return false;
    }
    if (isBinaryBuf(buf)) return false;
    const text = buf.toString('utf8');
    const lines = text.split(/\r\n|\n|\r/);
    const snippets = [];
    let density = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();
      let hits = 0;
      for (const t of tokens) {
        if (lower.includes(t)) hits += 1;
      }
      if (hits === 0) continue;
      density += hits;
      const clipped = line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line;
      snippets.push({ line: i + 1, text: clipped, hits });
    }
    const bonus = pathBonus(rel, tokens);
    if (!snippets.length && bonus === 0) return false;
    snippets.sort((a, b) => b.hits - a.hits || a.line - b.line);
    const topSnips = snippets.slice(0, 3);
    const score = density * 3 + bonus + topSnips.reduce((s, x) => s + x.hits, 0);
    if (score <= 0) return false;
    byFile.set(rel, {
      score,
      snippets: topSnips.length ? topSnips : [{ line: 1, text: '(path match)', hits: 0 }],
    });
    return false;
  };

  let st;
  try {
    st = await stat(startAbs);
  } catch {
    throw new Error('path not found');
  }
  if (st.isFile()) {
    await considerFile(startAbs);
  } else if (st.isDirectory()) {
    await walkFiles(root, startAbs, considerFile, { skipName: skipSearchName, maxFiles: 12_000 });
  } else {
    throw new Error('not a file or directory');
  }

  const ranked = [...byFile.entries()].sort((a, b) => b[1].score - a[1].score);
  const rows = [];
  for (const [rel, info] of ranked) {
    for (const sn of info.snippets) {
      rows.push(`${rel}:${sn.line}:${sn.text}`);
      if (rows.length >= cap) break;
    }
    if (rows.length >= cap) break;
  }
  if (!rows.length) return 'no matches';
  let content = rows.join('\n');
  if (ranked.length > 0 && rows.length >= cap) content += `\n/* truncated at ${cap} snippets */`;
  return content;
}

export { MAX_SNIPPETS };
