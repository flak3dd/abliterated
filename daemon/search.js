/**
 * Glob + path-jail helpers for the localhost bridge.
 */

import path from 'node:path';
import fs from 'node:fs';
import { readdir, realpath } from 'node:fs/promises';

export function skipDirentName(name) {
  if (name === 'node_modules') return true;
  if (name.startsWith('.') && name !== '.gitignore') return true;
  return false;
}

export function skipSearchName(name) {
  if (skipDirentName(name)) return true;
  if (name === 'dist' || name === 'build') return true;
  return false;
}

/**
 * Path jail: resolve + realpath both sides so symlink escape cannot leave ROOT.
 * Sync variant used on hot paths; falls back to path.resolve when realpath fails
 * (missing targets still checked via lexical resolve).
 */
export function isInsideRoot(root, target) {
  const rootAbs = path.resolve(root);
  const resolved = path.resolve(rootAbs, target);
  let rootReal = rootAbs;
  let targetReal = resolved;
  try {
    rootReal = fs.realpathSync(rootAbs);
  } catch {
    /* root may be mid-create */
  }
  try {
    targetReal = fs.realpathSync(resolved);
  } catch {
    // Non-existent path: jail on the lexical resolve (parent must still be inside).
    targetReal = resolved;
  }
  const rel = path.relative(rootReal, targetReal);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Async realpath jail for RPC entry points. */
export async function isInsideRootAsync(root, target) {
  const rootAbs = path.resolve(root);
  const resolved = path.resolve(rootAbs, target);
  let rootReal = rootAbs;
  let targetReal = resolved;
  try {
    rootReal = await realpath(rootAbs);
  } catch {
    /* ignore */
  }
  try {
    targetReal = await realpath(resolved);
  } catch {
    targetReal = resolved;
  }
  const rel = path.relative(rootReal, targetReal);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function toRel(root, abs) {
  const rel = path.relative(root, abs);
  if (rel === '') return '.';
  return rel.split(path.sep).join('/');
}

export function globToRegExp(pattern) {
  const p = String(pattern || '').replace(/\\/g, '/');
  let src = '';
  let i = 0;
  while (i < p.length) {
    if (p[i] === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') {
        src += '(?:.*/)?';
        i += 3;
      } else {
        src += '.*';
        i += 2;
      }
    } else if (p[i] === '*') {
      src += '[^/]*';
      i += 1;
    } else if (p[i] === '?') {
      src += '[^/]';
      i += 1;
    } else {
      src += p[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${src}$`);
}

export function matchGlob(pattern, relPath) {
  const rel = String(relPath || '').replace(/\\/g, '/');
  const pat = String(pattern || '').replace(/\\/g, '/');
  try {
    return globToRegExp(pat).test(rel);
  } catch {
    return rel.includes(pat);
  }
}

/**
 * Walk files under startAbs, staying inside root. onFile(abs) may return true to stop.
 */
export async function walkFiles(root, startAbs, onFile, opts = {}) {
  const skip = opts.skipName || skipSearchName;
  const maxFiles = opts.maxFiles || 20_000;
  const acc = { n: 0, stop: false };

  async function walk(dirAbs) {
    if (acc.stop || acc.n >= maxFiles) {
      acc.stop = true;
      return;
    }
    let names;
    try {
      names = await readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of names) {
      if (acc.stop) return;
      const childAbs = path.join(dirAbs, d.name);
      if (!isInsideRoot(root, childAbs)) continue;
      if (d.isSymbolicLink()) continue;
      if (d.isDirectory()) {
        if (skip(d.name)) continue;
        await walk(childAbs);
      } else if (d.isFile()) {
        if (skip(d.name)) continue;
        acc.n += 1;
        const stop = await onFile(childAbs);
        if (stop) {
          acc.stop = true;
          return;
        }
      }
    }
  }

  await walk(startAbs);
  return acc;
}
