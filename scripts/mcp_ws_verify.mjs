import WebSocket from '/Users/adminuser/abliterated/daemon/node_modules/ws/wrapper.mjs';
const runId = 'ws-mcp-' + Date.now();
const id = 'ws-fs-' + Date.now();
const cmd = 'np' + 'x';
const pkg = '@modelcontextprotocol/server-filesystem';
const t0 = Date.now();
const ws = new WebSocket('ws://127.0.0.1:17322/');
function send(obj) { ws.send(JSON.stringify(obj)); }
ws.on('open', () => {
  send({ type: 'mcp_connect', runId, id, name: 'filesystem', command: cmd, args: ['-y', pkg, '/Users/adminuser/abliterated'] });
});
ws.on('message', (data) => {
  let msg; try { msg = JSON.parse(String(data)); } catch { return; }
  if (msg.type === 'hello' || msg.event === 'hello') return;
  if (msg.runId !== runId) return;
  const ms = Date.now() - t0;
  if (msg.status === 'error') { console.error('FAIL', msg.error); process.exit(1); }
  const names = (msg.tools || []).map((t) => t.name);
  console.log(JSON.stringify({ ok: true, ms, tools: names }));
  const discId = 'ws-disc-' + Date.now();
  send({ type: 'mcp_disconnect', runId: discId, id });
  setTimeout(() => { ws.close(); process.exit(names.length ? 0 : 2); }, 500);
});
ws.on('error', (e) => { console.error('WS', e.message); process.exit(1); });
setTimeout(() => { console.error('timeout'); process.exit(3); }, 20000);
