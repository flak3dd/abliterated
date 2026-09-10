import { execSync } from 'node:child_process';

async function waitReady() {
  console.log('Waiting for Spark GPT-OSS 120B to be ready (loading ~60GB safetensors shards)...');
  const start = Date.now();
  let lastStatus = '';

  while (Date.now() - start < 15 * 60 * 1000) {
    try {
      const res = execSync("ssh flak3dd 'curl -s http://127.0.0.1:8000/v1/models || echo NOT_READY'", { encoding: 'utf8' }).trim();
      if (res.includes('gpt-oss-120b-abliterated')) {
        console.log('\n>>> SPARK GPT-OSS 120B IS READY! <<<');
        return true;
      }

      // Check shard progress from docker logs (convert \r to \n for tqdm)
      const logs = execSync("ssh flak3dd 'docker logs gpt-oss-120b-abliterated 2>&1 | tr \"\\r\" \"\\n\" | tail -n 8'", { encoding: 'utf8' });
      const shardMatch = logs.match(/Loading safetensors checkpoint shards:.*?(\d+%\s*Completed\s*\|\s*\d+\/\d+[^\]\n]*)/i);
      const currentStatus = shardMatch ? shardMatch[1] : logs.split('\n').filter(Boolean).pop();


      if (currentStatus && currentStatus !== lastStatus) {
        lastStatus = currentStatus;
        const elapsedSec = Math.round((Date.now() - start) / 1000);
        console.log(`[+${elapsedSec}s] ${currentStatus}`);
      }
    } catch (e) {
      // transient ssh error
    }

    await new Promise((r) => setTimeout(r, 15000));
  }

  throw new Error('Timeout waiting for gpt-oss-120b-abliterated to become ready.');
}

waitReady().catch((e) => {
  console.error(e.message);
  process.exit(1);
});



































