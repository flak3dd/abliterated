#!/usr/bin/env node

async function inspectChat(reasoning_effort) {
  console.log(`\n--- Testing with reasoning_effort: ${reasoning_effort} ---`);
  const payload = {
    model: 'gpt-oss-120b-abliterated',
    messages: [
      { role: 'system', content: 'You are a direct, concise senior software engineer.' },
      { role: 'user', content: 'Explain in two sentences how a bloom filter works.' }
    ],
    max_tokens: 800,
    temperature: 0.3,
    repetition_penalty: 1.15,
    reasoning_effort
  };

  const start = Date.now();
  const res = await fetch('http://127.0.0.1:8000/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const durationSec = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`HTTP Status: ${res.status} (${durationSec}s)`);
  const data = await res.json();
  if (!res.ok) {
    console.error('Error:', data);
    return;
  }
  const choice = data.choices?.[0];
  const msg = choice?.message || {};
  console.log('Usage:', JSON.stringify(data.usage));
  console.log('Finish Reason:', choice?.finish_reason);
  console.log('Reasoning:', repr(msg.reasoning || msg.reasoning_content));
  console.log('Content:', repr(msg.content));
}

function repr(s) {
  if (!s) return '(empty)';
  return s.length > 200 ? s.slice(0, 200) + '...' : s;
}

async function main() {
  await inspectChat('low');
  await inspectChat('medium');
}

main();
