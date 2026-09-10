import { execSync } from 'node:child_process';

try {
  console.log('Executing: git push origin main...');
  execSync('git push origin main', { stdio: 'inherit' });
  console.log('Push complete.');
} catch (err) {
  console.error('Push failed:', err.message);
  process.exit(1);
}
