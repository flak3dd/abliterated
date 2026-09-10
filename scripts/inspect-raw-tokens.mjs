#!/usr/bin/env node

async function inspectRawTokens() {
  const renderRes = await fetch('http://127.0.0.1:8000/v1/chat/completions/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-oss-120b-abliterated',
      messages: [
        { role: 'user', content: 'Say hello in 3 words.' }
      ]
    })
  });
  const renderData = await renderRes.json();
  const baseTokens = renderData.token_ids;

  // Test A: Ending with <|start|>assistant
  await testWithTokens("A: Ending with <|start|>assistant", baseTokens);

  // Test B: Ending with <|start|>assistant<|channel|>analysis<|message|>
  // 200005: <|channel|>, 35644: analysis, 200008: <|message|>
  await testWithTokens("B: Ending with <|channel|>analysis<|message|>", [...baseTokens, 200005, 35644, 200008]);

  // Test C: Ending with <|start|>assistant<|channel|>final<|message|>
  // 200005: <|channel|>, 17196: final, 200008: <|message|>
  await testWithTokens("C: Ending with <|channel|>final<|message|>", [...baseTokens, 200005, 17196, 200008]);
}

async function testWithTokens(name, tokens) {
  console.log(`\n=== TEST ${name} ===`);
  const res = await fetch('http://127.0.0.1:8000/v1/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-oss-120b-abliterated',
      prompt: tokens,
      max_tokens: 150,
      temperature: 0.3,
      repetition_penalty: 1.15,
      stop: ["<|end|>", "<|return|>", "<|endoftext|>"]
    })
  });
  const data = await res.json();
  const choice = data.choices?.[0];
  console.log('Status:', res.status, 'Finish reason:', choice?.finish_reason);
  console.log('Generated text:\n', repr(choice?.text));
}

function repr(s) {
  return JSON.stringify(s);
}

inspectRawTokens().catch(console.error);
