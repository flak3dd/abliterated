/**
 * Encoding + EOL helpers for the localhost bridge.
 * Read detects BOM / utf8 / latin1 and original newline; write restores both.
 */

export function detectEol(text) {
  if (!text) return '\n';
  let crlf = 0;
  let cr = 0;
  let lf = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\r' && text[i + 1] === '\n') {
      crlf += 1;
      i += 1;
    } else if (text[i] === '\r') {
      cr += 1;
    } else if (text[i] === '\n') {
      lf += 1;
    }
  }
  if (crlf >= lf && crlf >= cr && crlf > 0) return '\r\n';
  if (cr >= lf && cr > 0) return '\r';
  return '\n';
}

export function splitOnEol(text, eol) {
  if (!text) return [];
  const parts = text.split(eol);
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

export function restoreEol(text, eol) {
  const unified = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (eol === '\n') return unified;
  return unified.split('\n').join(eol);
}

function swap16(buf) {
  const out = Buffer.alloc(buf.length);
  const even = buf.length - (buf.length % 2);
  for (let i = 0; i < even; i += 2) {
    out[i] = buf[i + 1];
    out[i + 1] = buf[i];
  }
  if (buf.length % 2) out[buf.length - 1] = buf[buf.length - 1];
  return out;
}

export function decodeBuffer(buf) {
  if (!buf || buf.length === 0) {
    return { encoding: 'utf8', text: '', bom: false };
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { encoding: 'utf-8', text: buf.slice(3).toString('utf8'), bom: true };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { encoding: 'utf-16le', text: buf.slice(2).toString('utf16le'), bom: true };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { encoding: 'utf-16be', text: swap16(buf.slice(2)).toString('utf16le'), bom: true };
  }
  const utf8 = buf.toString('utf8');
  const replacements = (utf8.match(/\uFFFD/g) || []).length;
  if (utf8.length > 0 && replacements * 4 >= utf8.length) {
    return { encoding: 'latin1', text: buf.toString('latin1'), bom: false };
  }
  return { encoding: 'utf8', text: utf8, bom: false };
}

export function normalizeEncoding(enc) {
  const e = String(enc || 'utf8').toLowerCase();
  if (e === 'utf-8' || e === 'utf8') return 'utf8';
  if (e === 'utf-16le' || e === 'utf16le') return 'utf-16le';
  if (e === 'utf-16be' || e === 'utf16be') return 'utf-16be';
  if (e === 'latin1' || e === 'iso-8859-1' || e === 'ascii') return 'latin1';
  return 'utf8';
}

export function encodeFileText(text, encoding, bom) {
  const enc = normalizeEncoding(encoding);
  if (enc === 'latin1') {
    return Buffer.from(text, 'latin1');
  }
  if (enc === 'utf-16le') {
    const body = Buffer.from(text, 'utf16le');
    return bom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body;
  }
  if (enc === 'utf-16be') {
    const be = swap16(Buffer.from(text, 'utf16le'));
    return bom ? Buffer.concat([Buffer.from([0xfe, 0xff]), be]) : be;
  }
  const body = Buffer.from(text, 'utf8');
  if (bom) return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]);
  return body;
}

export function applyUnified(original, patchText) {
  const eol = detectEol(original) || detectEol(patchText) || '\n';
  const srcLines = splitOnEol(original, eol);
  const patchLines = String(patchText ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');
  if (patchLines.length && patchLines[patchLines.length - 1] === '') patchLines.pop();
  const hunks = [];
  let cur = null;
  for (const line of patchLines) {
    const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (m) {
      cur = { oldStart: Number(m[1]), lines: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('\\')) continue;
    if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('diff ')) continue;
    cur.lines.push(line);
  }

  if (hunks.length === 0) {
    const plus = patchLines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
    if (plus.length) return plus.join(eol) + eol;
    throw new Error('no hunks in patch');
  }

  let out = srcLines.slice();
  for (const hunk of [...hunks].reverse()) {
    const idx = Math.max(0, hunk.oldStart - 1);
    const produced = [];
    let cursor = idx;
    for (const raw of hunk.lines) {
      const tag = raw[0] || ' ';
      const body = raw.slice(1);
      if (tag === ' ') {
        produced.push(out[cursor] ?? body);
        cursor += 1;
      } else if (tag === '-') {
        cursor += 1;
      } else if (tag === '+') {
        produced.push(body);
      } else {
        produced.push(raw);
      }
    }
    const removed = hunk.lines.filter((l) => l.startsWith('-') || l.startsWith(' ')).length;
    out.splice(idx, removed, ...produced);
  }
  return out.join(eol) + eol;
}
