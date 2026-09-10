import http from 'node:http';

const hosts = [
  'http://127.0.0.1:8000',
  'http://gx10-d0e7.local:8000',
  'http://192.168.4.101:8000',
];

async function checkHost(base) {
  try {
    const res = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(3000) });
    const text = await res.text();
    console.log(`[OK] ${base}/v1/models (Status ${res.status}):`);
    console.log(text);
    return true;
  } catch (err) {
    console.log(`[FAIL] ${base}/v1/models: ${err.message}`);
    return false;
  }
}

for (const h of hosts) {
  const ok = await checkHost(h);
  if (ok) {
    try {
      console.log(`Testing POST ${h}/v1/chat/completions with qwen-abliterated...`);
      const chatRes = await fetch(`${h}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen-abliterated',
          messages: [{ role: 'user', content: 'Say hello in 5 words.' }],
          max_tokens: 30,
        }),
      });
      console.log(`Chat status: ${chatRes.status}`);
      const chatJson = await chatRes.json();
      console.log('Response content:', chatJson.choices?.[0]?.message?.content);
    } catch (e) {
      console.error('Chat test error:', e.message);
    }
  }
}

