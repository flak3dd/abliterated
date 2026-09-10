#!/usr/bin/env node
import { execSync } from 'node:child_process';

async function waitReady() {
  console.log('Waiting for Spark GPT-OSS 120B to be ready...');
  const start = Date.now();

  while (Date.now() - start < 15 * 60 * 1000) {
    try {
      const res = execSync("ssh flak3dd 'curl -s --connect-timeout 5 http://127.0.0.1:8000/v1/models 2>/dev/null || echo NOT_READY'", { encoding: 'utf8' }).trim();
      if (res.includes('gpt-oss-120b-abliterated')) {
        console.log('\n✅ SPARK GPT-OSS 120B IS READY!');
        return true;
      }

      // Check loading progress
      const logs = execSync("ssh flak3dd 'docker logs gpt-oss-120b-abliterated 2>&1 | tr \"\\r\" \"\\n\" | tail -n 5'", { encoding: 'utf8' });
      const shardMatch = logs.match(/Loading safetensors checkpoint shards:.*?(\d+%\s*Completed\s*\|\s*\d+\/\d+[^\]\n]*)/i);
      const currentStatus = shardMatch ? shardMatch[1] : logs.split('\n').filter(Boolean).pop()?.trim() || 'Initializing...';

      const elapsedSec = Math.round((Date.now() - start) / 1000);
      console.log(`[+${elapsedSec}s] ${currentStatus}`);
    } catch (e) {
      // Transient error
    }

    await new Promise(r => setTimeout(r, 10000));
  }

  throw new Error('Timeout waiting for model');
}

async function testCompletion() {
  console.log('\n🧪 Testing chat completion...');
  try {
    const payload = JSON.stringify({
      model: "gpt-oss-120b-abliterated",
      messages: [
        { role: "user", content: "Write a 1-line hello world in Python" }
      ],
      max_tokens: 50,
      temperature: 0.3
    });

    const res = execSync(`ssh flak3dd 'curl -s -X POST -H "Content-Type: application/json" -d '${payload}' http://127.0.0.1:8000/v1/chat/completions'`, { encoding: 'utf8' });
    const data = JSON.parse(res);

    if (data.choices?.[0]?.message?.content) {
      console.log('✅ SUCCESS! Got response:');
      console.log(data.choices[0].message.content);
      console.log('\n🎉 HTTP 500 error is FIXED!');
      return true;
    } else {
      console.log('❌ Unexpected response:', data);
      return false;
    }
  } catch (e) {
    console.error('❌ Test failed:', e.message);
    return false;
  }
}

async function main() {
  await waitReady();
  await testCompletion();
}

main().catch(console.error);
