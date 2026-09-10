import { execSync } from 'node:child_process';

try {
  const out = execSync("ssh flak3dd 'docker logs gpt-oss-120b-abliterated 2>&1 | tail -n 20'", { encoding: 'utf8' });
  console.log('Docker logs tail:\n' + out);
} catch (e) {
  console.error('Error:', e.message);
}








