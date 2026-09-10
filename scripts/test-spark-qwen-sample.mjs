async function testChat() {
  const p4 = `This function sometimes returns NaN when input comes from a form. Find the bug and fix it defensively:

\`\`\`javascript
function calculateInvoiceTotal(subtotal, taxRate, discountAmount, shippingFee) {
  // taxRate comes as percentage e.g. "8.25" or 8.25
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax - discountAmount + shippingFee;
  return Number(total.toFixed(2));
}
\`\`\``;

  console.log('Sending Prompt 4 to http://127.0.0.1:8000/v1/chat/completions...');
  const res = await fetch('http://127.0.0.1:8000/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-oss-120b-abliterated',
      messages: [
        {
          role: 'system',
          content: 'You are an expert software engineer and systems architect. Provide direct, thorough, fully implemented solutions with zero placeholder code or stubs. Strictly follow all user constraints and formatting instructions.'
        },
        { role: 'user', content: p4 }
      ],
      temperature: 0.3,
      max_tokens: 500,
      stop: ['<|end|>', '<|endoftext|>', '<|start|>'],
      stream: true
    })

  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let lineCount = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    for (const line of text.split('\n')) {
      if (line.trim()) {
        lineCount++;
        console.log(`[L${lineCount}]`, line);
      }
    }
  }
}

testChat().catch(console.error);


