#!/usr/bin/env node

async function testPrompt(name, payload) {
  console.log(`\n--- TEST: ${name} ---`);
  console.log('Payload:', JSON.stringify(payload, null, 2));
  try {
    const res = await fetch('http://127.0.0.1:8000/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    console.log('Response status:', res.status);
    console.log('Response data:', JSON.stringify(data, null, 2));
    if (data.choices?.[0]?.message?.content) {
      console.log('CONTENT:', repr(data.choices[0].message.content));
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}

function repr(str) {
  return JSON.stringify(str);
}

async function main() {
  const prompts = [
    {
      id: "p1",
      title: "Python File Watcher",
      text: "Write a Python script that watches a folder and renames new files to YYYY-MM-DD_originalname.ext based on creation date. Include error handling for locked files."
    },
    {
      id: "p2",
      title: "Docker Compose Stack",
      text: "Write a docker-compose.yml for a Node.js app with Postgres and Redis, including health checks and persistent volumes. Explain each non-obvious line."
    },
    {
      id: "p3",
      title: "React Data Table (Hooks Only)",
      text: "Write a React component for a searchable, paginated, sortable data table using only hooks — no external UI library."
    },
    {
      id: "p4",
      title: "Defensive Fix for NaN in Form Input Math",
      text: `This function sometimes returns NaN when input comes from a form. Find the bug and fix it defensively:

\`\`\`javascript
function calculateInvoiceTotal(subtotal, taxRate, discountAmount, shippingFee) {
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax - discountAmount + shippingFee;
  return Number(total.toFixed(2));
}
\`\`\``
    }
  ];

  for (const p of prompts) {
    console.log(`\n================================================================`);
    console.log(`TESTING: ${p.title}`);
    console.log(`================================================================`);

    const formattedPrompt = `<|start|>system<|message|>You are an expert software engineer. Provide direct, complete, production-ready code with error handling.<|end|><|start|>user<|message|>${p.text}<|end|><|start|>assistant<|channel|>final<|message|>`;

    const res = await fetch('http://127.0.0.1:8000/v1/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "gpt-oss-120b-abliterated",
        prompt: formattedPrompt,
        max_tokens: 1200,
        temperature: 0.3,
        repetition_penalty: 1.15,
        stop: ["<|end|>", "<|return|>", "<|endoftext|>", "<|start|>"]
      })
    });

    const data = await res.json();
    const text = data.choices?.[0]?.text || '';
    console.log('STATUS:', res.status);
    console.log('TOKENS:', data.usage?.completion_tokens);
    console.log('RESPONSE PREVIEW:\n' + text.slice(0, 700));
    console.log('...\n[LENGTH: ' + text.length + ' chars]');
  }
}

main().catch(console.error);
