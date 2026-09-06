import assert from 'node:assert/strict';
import {
  DEFAULT_PALACE,
  DEFAULT_ROOM,
  MISSING_CLI,
  clipText,
  formatWakePrompt,
  mcpServerSpec,
  sanitizePalaceName,
  wingFromRoot,
} from './mempalace.js';

assert.equal(sanitizePalaceName('Abliterated IDE'), 'abliterated-ide');
assert.equal(sanitizePalaceName('***'), 'workspace');
assert.equal(sanitizePalaceName(''), 'workspace');
assert.equal(wingFromRoot('/Users/adminuser/abliterated'), 'abliterated');
assert.equal(wingFromRoot('/tmp/My App'), 'my-app');

assert.ok(clipText('abcd', 3).startsWith('abc'));
assert.equal(clipText('ab', 10), 'ab');

assert.equal(formatWakePrompt(''), '');
const wake = formatWakePrompt('I am Atlas.\nProject: abliterated.');
assert.match(wake, /MemPalace wake-up/);
assert.match(wake, /memory_search/);
assert.match(wake, /Atlas/);

assert.ok(DEFAULT_PALACE.includes('.mempalace'));
assert.equal(DEFAULT_ROOM, 'abliterated-chat');
assert.match(MISSING_CLI, /uv tool install mempalace/);

const spec = mcpServerSpec('/tmp/palace');
assert.equal(spec.name, 'mempalace');
assert.equal(spec.command, 'uvx');
assert.ok(spec.args.includes('mempalace.mcp_server'));
assert.equal(spec.env.MEMPALACE_PALACE_PATH, '/tmp/palace');

console.log('mempalace.test.js ok');
