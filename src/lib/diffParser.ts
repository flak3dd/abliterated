import type { DiffHunk } from '../types';

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(rawDiff: string, defaultFile = ''): DiffHunk[] {
  const lines = rawDiff.replace(/\r\n/g, '\n').split('\n');
  const hunks: DiffHunk[] = [];
  let file = defaultFile;
  let buffer: string[] = [];
  let meta: { oldStart: number; oldLines: number; newStart: number; newLines: number } | null = null;

  const flush = () => {
    if (!meta) return;
    hunks.push({
      file,
      oldStart: meta.oldStart,
      oldLines: meta.oldLines,
      newStart: meta.newStart,
      newLines: meta.newLines,
      content: buffer.join('\n'),
      status: 'pending',
    });
    buffer = [];
    meta = null;
  };

  for (const line of lines) {
    if (line.startsWith('--- ')) {
      flush();
      const rest = line.slice(4).trim().replace(/^[ab]\//, '');
      if (rest && rest !== '/dev/null') file = rest.split('\t')[0] || file;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const rest = line.slice(4).trim().replace(/^[ab]\//, '');
      if (rest && rest !== '/dev/null') file = rest.split('\t')[0] || file;
      continue;
    }
    const hunkMatch = line.match(HUNK_RE);
    if (hunkMatch) {
      flush();
      meta = {
        oldStart: Number(hunkMatch[1]),
        oldLines: hunkMatch[2] ? Number(hunkMatch[2]) : 1,
        newStart: Number(hunkMatch[3]),
        newLines: hunkMatch[4] ? Number(hunkMatch[4]) : 1,
      };
      continue;
    }
    if (meta) {
      if (line.startsWith('\\')) continue;
      buffer.push(line);
    }
  }
  flush();

  if (hunks.length === 0 && rawDiff.trim() && defaultFile) {
    hunks.push({
      file: defaultFile,
      oldStart: 1,
      oldLines: 0,
      newStart: 1,
      newLines: rawDiff.split('\n').length,
      content: rawDiff,
      status: 'pending',
    });
  }
  return hunks;
}

export function hunkToPatch(hunk: DiffHunk): string {
  return [
    `--- a/${hunk.file}`,
    `+++ b/${hunk.file}`,
    `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    hunk.content,
  ].join('\n');
}
