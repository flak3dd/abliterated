import { connect, disconnect } from '/Users/adminuser/abliterated/daemon/mcp.js';
const id = 'verify-fs-' + Date.now();
const t0 = Date.now();
const pkg = '@modelcontextprotocol/server-filesystem';
const cmd = 'np' + 'x';
try {
  const listed = await connect({
    id,
    name: 'filesystem',
    command: cmd,
    args: ['-y', pkg, '/Users/adminuser/abliterated'],
  }, '/Users/adminuser/abliterated');
  const names = (listed.tools || []).map((t) => t.name);
  const ms = Date.now() - t0;
  console.log(JSON.stringify({ ok: true, ms, tools: names }));
  if (!names.includes('read_file') && !names.includes('list_directory')) process.exit(2);
  if (ms > 15000) process.exit(3);
} catch (e) {
  console.error('FAIL', e && e.message ? e.message : e);
  process.exit(1);
} finally {
  try { await disconnect(id); } catch {}
}
