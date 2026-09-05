#!/usr/bin/env node
/** Minimal MCP stdio server for smoke tests. */
let buf = Buffer.alloc(0);
const tools = [
  {
    name: 'echo',
    description: 'Echo a message',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
  },
  {
    name: 'add',
    description: 'Add two numbers',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
  },
];

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function handle(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock-mcp', version: '0.0.1' },
      },
    });
    return;
  }
  if (msg.method === 'notifications/initialized') return;
  if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools } });
    return;
  }
  if (msg.method === 'tools/call') {
    const name = msg.params?.name;
    const args = msg.params?.arguments || {};
    let text = '';
    if (name === 'echo') text = String(args.message ?? '');
    else if (name === 'add') text = String(Number(args.a) + Number(args.b));
    else {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: `unknown tool ${name}` },
      });
      return;
    }
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: { content: [{ type: 'text', text }] },
    });
  }
}

process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, Buffer.from(chunk)]);
  while (true) {
    const nl = buf.indexOf('\n');
    if (nl < 0) break;
    const line = buf.slice(0, nl).toString('utf8').replace(/\r$/, '');
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    try {
      handle(JSON.parse(line));
    } catch (e) {
      /* ignore */
    }
  }
});
