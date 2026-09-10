import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

console.log('================================================================');
console.log(' CONFIGURE NATIVE HARMONY GPT-OSS ON SPARK HOST (NO FILTERS)    ');
console.log('================================================================');

// 1. Remove obsolete serving_patch.py from remote spark host
console.log('1. Cleaning up custom serving_patch.py from Spark host...');
execSync("ssh flak3dd 'rm -f ~/spark/serving_patch.py'", { stdio: 'inherit' });

// 2. Sync clean compose file without serving_patch.py mount
console.log('2. Syncing clean docker-compose.gpt-oss-120b-abliterated.yml...');
const composePath = path.join(root, 'spark', 'docker-compose.gpt-oss-120b-abliterated.yml');
const composeContent = fs.readFileSync(composePath, 'utf8');
execSync(`ssh flak3dd 'cat << "EOF" > ~/spark/docker-compose.gpt-oss-120b-abliterated.yml\n${composeContent}\nEOF'`, { stdio: 'inherit' });

// 3. Sync serve-gpt-oss script without external filters
console.log('3. Syncing serve-gpt-oss-120b-abliterated.sh...');
const serveScriptPath = path.join(root, 'spark', 'serve-gpt-oss-120b-abliterated.sh');
const serveScriptContent = fs.readFileSync(serveScriptPath, 'utf8');
execSync(`ssh flak3dd 'cat << "EOF" > ~/spark/serve-gpt-oss-120b-abliterated.sh\n${serveScriptContent}\nEOF'`, { stdio: 'inherit' });
execSync("ssh flak3dd 'chmod +x ~/spark/serve-gpt-oss-120b-abliterated.sh'", { stdio: 'inherit' });

console.log('\n✔ Successfully configured GPT-OSS vLLM to use built-in native Harmony with all filters removed!');
