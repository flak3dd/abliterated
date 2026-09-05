import { applyUnified, decodeBuffer, detectEol, encodeFileText, restoreEol } from './fsutil.js';
import assert from 'node:assert/strict';

assert.equal(detectEol('a\r\nb\r\n'), '\r\n');
assert.equal(detectEol('a\nb\n'), '\n');
assert.equal(detectEol('a\rb\r'), '\r');

const crlf = 'hello\r\nworld\r\n';
const patched = applyUnified(crlf, '@@ -1,2 +1,2 @@\n hello\n-world\n+there\n');
assert.ok(patched.includes('\r\n'), 'applyUnified preserves CRLF');
assert.equal(patched, 'hello\r\nthere\r\n');

const lf = applyUnified('hello\nworld\n', '@@ -1,2 +1,2 @@\n hello\n-world\n+there\n');
assert.equal(lf, 'hello\nthere\n');

const utf8bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hi', 'utf8')]);
const d8 = decodeBuffer(utf8bom);
assert.equal(d8.encoding, 'utf-8');
assert.equal(d8.text, 'hi');
assert.equal(d8.bom, true);
const back8 = encodeFileText(d8.text, d8.encoding, d8.bom);
assert.ok(back8.equals(utf8bom));

const latin = Buffer.from([0xe9, 0xe9, 0xe9, 0xe9]); // éééé in latin1; invalid-ish as utf8
const dl = decodeBuffer(latin);
assert.equal(dl.encoding, 'latin1');
assert.equal(dl.text, '\u00e9\u00e9\u00e9\u00e9');

const restored = restoreEol('a\nb\n', '\r\n');
assert.equal(restored, 'a\r\nb\r\n');

console.log('fsutil.test.js ok');
