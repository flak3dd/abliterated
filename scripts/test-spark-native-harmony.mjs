#!/usr/bin/env node

const MODEL = 'gpt-oss-120b-abliterated';

async function testNonStreaming() {
  console.log('\n======================================================');
  console.log('TEST 1: Non-Streaming Chat Completion');
  console.log('======================================================');

  const payload = {
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are a direct, concise senior software engineer.'
      },
      {
        role: 'user',
        content: 'Explain in two sentences how a bloom filter works.'
      }
    ],
    max_tokens: 800,
    temperature: 0.3,
    repetition_penalty: 1.15
  };

  const start = Date.now();
  const res = await fetch('http://127.0.0.1:8000/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const durationSec = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`HTTP Status: ${res.status} (${durationSec}s)`);

  if (!res.ok) {
    const errText = await res.text();
    console.error('Error response:', errText);
    return false;
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  const msg = choice?.message || {};

  const reasoningText = msg.reasoning || msg.reasoning_content || '';
  const contentText = msg.content || '';

  console.log('Usage:', JSON.stringify(data.usage));
  console.log('Finish Reason:', choice?.finish_reason);
  console.log('\n[Reasoning / Thought]:\n', reasoningText.slice(0, 400) + (reasoningText.length > 400 ? '...' : ''));
  console.log('\n[Final Content]:\n', contentText);

  const hasContent = Boolean(contentText && contentText.trim().length > 0);
  console.log(`\nTest 1 Result: ${hasContent ? 'PASSED' : 'FAILED'}`);
  return hasContent;
}

async function testStreaming() {
  console.log('\n======================================================');
  console.log('TEST 2: Streaming Chat Completion (Native Harmony SSE)');
  console.log('======================================================');

  const payload = {
    model: MODEL,
    messages: [
      {
        role: 'user',
        content: 'Write a one-line bash command to count lines in all .js files in current dir.'
      }
    ],
    max_tokens: 800,
    temperature: 0.3,
    repetition_penalty: 1.15,
    stream: true
  };

  const start = Date.now();
  const res = await fetch('http://127.0.0.1:8000/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('Stream error:', errText);
    return false;
  }

  let streamedReasoning = '';
  let streamedContent = '';
  let chunkCount = 0;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      if (trimmed === 'data: [DONE]') continue;

      try {
        const parsed = JSON.parse(trimmed.slice(5).trim());
        chunkCount++;
        const delta = parsed.choices?.[0]?.delta;
        const reasoningDelta = delta?.reasoning || delta?.reasoning_content;
        if (reasoningDelta) {
          streamedReasoning += reasoningDelta;
        }
        if (delta?.content) {
          streamedContent += delta.content;
        }
      } catch (e) {
        // ignore incomplete json chunk
      }
    }
  }

  const durationSec = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`Stream complete in ${durationSec}s. Received ${chunkCount} chunks.`);
  console.log('\n[Streamed Reasoning / Thought]:\n', streamedReasoning.slice(0, 400) + (streamedReasoning.length > 400 ? '...' : ''));
  console.log('\n[Streamed Final Content]:\n', streamedContent);

  const hasContent = Boolean(streamedContent && streamedContent.trim().length > 0);
  console.log(`\nTest 2 Result: ${hasContent ? 'PASSED' : 'FAILED'}`);
  return hasContent;
}

async function main() {
  console.log(`Testing native Harmony GPT-OSS on http://127.0.0.1:8000/v1 ...`);
  const t1 = await testNonStreaming();
  const t2 = await testStreaming();

  if (t1 && t2) {
    console.log('\n>>> ALL NATIVE HARMONY TESTS PASSED! <<<');
    process.exit(0);
  } else {
    console.error('\n>>> SOME TESTS FAILED <<<');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
