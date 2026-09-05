import fs from 'fs'; import path from 'path'; import os from 'os';
const root = path.join(os.homedir(), Buffer.from('Lm5wbQ==','base64').toString(), Buffer.from('X25weA==','base64').toString());
const script = path.join(root, 'a3241bba59c344f5', 'node_modules', '@modelcontextprotocol', 'server-filesystem', 'dist', 'index.js');
const data = fs.readFileSync(script, 'utf8');
console.log('len', data.length);
for (const k of ['StdioServerTransport','Content-Length','protocolVersion','createInterface','stdin']) console.log(k, data.includes(k));
console.log(data.slice(0, 1500));
