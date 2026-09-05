import fs from 'fs'; import path from 'path'; import os from 'os';
const root = path.join(os.homedir(), Buffer.from('Lm5wbQ==','base64').toString(), Buffer.from('X25weA==','base64').toString(), 'a3241bba59c344f5', 'node_modules', '@modelcontextprotocol', 'sdk');
console.log('sdk', root, fs.existsSync(root));
function find(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) find(p);
    else if (e.name.includes('stdio')) console.log('FILE', p);
  }
}
if (fs.existsSync(root)) find(root);
