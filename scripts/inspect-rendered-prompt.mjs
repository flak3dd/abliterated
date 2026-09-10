#!/usr/bin/env node

async function inspectRender() {
  const payload = {
    model: 'gpt-oss-120b-abliterated',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' }
    ]
  };

  try {
    const res = await fetch('http://127.0.0.1:8000/v1/chat/completions/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log('Status:', res.status);
    const data = await res.json();
    console.log('Rendered prompt token count:', data.token_ids?.length);

    const detokRes = await fetch('http://127.0.0.1:8000/detokenize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-oss-120b-abliterated',
        tokens: data.token_ids
      })
    });
    const detokData = await detokRes.json();
    console.log('Decoded prompt:\n', detokData.prompt);
  } catch (e) {
    console.error(e);
  }
}

inspectRender();
