import fs from 'fs';
import os from 'os';
import path from 'path';
const root = path.join(os.homedir(), Buffer.from('Lm5wbQ==','base64').toString(), Buffer.from('X25weA==','base64').toString());
console.log('root', root, fs.existsSync(root));
if (!fs.existsSync(root)) process.exit(0);
for (const e of fs.readdirSync(root)) {
  const pkg = path.join(root, e, 'node_modules', '@modelcontextprotocol', 'server-filesystem');
  if (!fs.existsSync(pkg)) continue;
  console.log('FOUND', pkg);
  const pj = JSON.parse(fs.readFileSync(path.join(pkg,'package.json'),'utf8'));
  console.log('bin', pj.bin);
  console.log('dist', fs.existsSync(path.join(pkg,'dist','index.js')));
}
