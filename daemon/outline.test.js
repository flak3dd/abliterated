
import assert from 'node:assert/strict';
import { outlineFromText } from './outline.js';
const o = outlineFromText('a.ts', 'export function foo() {}\nexport type Bar = number;\n');
assert.ok(o.includes('function:foo'));
assert.ok(o.includes('type:Bar'));
console.log('outline.test.js ok');
