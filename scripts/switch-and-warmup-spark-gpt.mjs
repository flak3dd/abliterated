import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

console.log('================================================================');
console.log(' SWITCHING SPARK HOST TO GPT-OSS 120B (MXFP4 ABLITERATED)       ');
console.log('================================================================');

// 1. Sync updated docker-compose.gpt-oss-120b-abliterated.yml to Spark
const localCompose = path.join(root, 'spark', 'docker-compose.gpt-oss-120b-abliterated.yml');
const composeContent = fs.readFileSync(localCompose, 'utf8');

console.log('Writing fixed docker-compose.gpt-oss-120b-abliterated.yml to Spark...');
execSync(`ssh flak3dd 'cat << "EOF" > ~/spark/docker-compose.gpt-oss-120b-abliterated.yml\n${composeContent}\nEOF'`, { stdio: 'inherit' });

// 2. Stop running qwen-abliterated container
console.log('Stopping qwen-abliterated on Spark...');
try {
  execSync("ssh flak3dd 'docker rm -f qwen-abliterated gpt-oss-120b-abliterated || true'", { stdio: 'inherit' });
} catch (e) {
  console.log('Container stop note:', e.message);
}

// 3. Launch gpt-oss-120b-abliterated
console.log('Launching gpt-oss-120b-abliterated via docker compose...');
execSync("ssh flak3dd 'cd ~/spark && docker compose -f docker-compose.gpt-oss-120b-abliterated.yml up -d --force-recreate'", { stdio: 'inherit' });

console.log('Container started. Initial logs:');
const initialLogs = execSync("ssh flak3dd 'docker logs gpt-oss-120b-abliterated 2>&1 | tail -25'", { encoding: 'utf8' });
console.log(initialLogs);
