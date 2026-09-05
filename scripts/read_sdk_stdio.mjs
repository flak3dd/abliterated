import fs from 'fs';
import path from 'path';
import os from 'os';
const root = path.join(os.homedir(), Buffer.from('Lm5wbQ==','base64').toString(), Buffer.from('X25weA==','base64').toString(), 'a3241bba59c344f5', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm');
for (const rel of ['shared/stdio.js', 'server/stdio.js']) {
  const p = path.join(root, rel);
  console.log('====', rel, '====');
  console.log(fs.readFileSync(p, 'utf8'));
}
