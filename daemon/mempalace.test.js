import assert from 'node:assert/strict';
import {
  DEFAULT_PALACE,
  DEFAULT_ROOM,
  MISSING_CLI,
  clipText,
  extraBinDirs,
  formatWakePrompt,
  mcpServerSpec,
  resolveUvBin,
  sanitizePalaceName,
  wingFromRoot,
  withExtraPath,
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
assert.match(spec.command, /uvx/);
assert.ok(spec.args.includes('mempalace.mcp_server'));
assert.equal(spec.env.MEMPALACE_PALACE_PATH, '/tmp/palace');

const dirs = extraBinDirs();
assert.ok(dirs.some((d) => d.includes('.local')));
const pathEnv = withExtraPath({ PATH: '/usr/bin' });
assert.match(pathEnv.PATH, /\.local/);
assert.ok(resolveUvBin());

console.log('mempalace.test.js ok');
