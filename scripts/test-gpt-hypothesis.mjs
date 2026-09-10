// Native fetch is global in Node 18+

async function test() {
  const userPrompt = "Write a Python script that watches a folder and renames new files to YYYY-MM-DD_originalname.ext based on creation date. Include error handling for locked files.";

  console.log("Testing /v1/chat/completions with repetition_penalty: 1.15...");
  const t0 = Date.now();
  const res = await fetch('http://127.0.0.1:8000/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: "gpt-oss-120b-abliterated",
      messages: [
        {
          role: "system",
          content: "You are an expert software engineer. Provide direct, complete, production-ready code with error handling."
        },
        {
          role: "user",
          content: userPrompt
        }
      ],
      max_tokens: 1200,
      temperature: 0.3,
      repetition_penalty: 1.15
    })
  });

  const data = await res.json();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`Status: ${res.status}, Elapsed: ${elapsed}s`);
  if (!res.ok) {
    console.error("Error:", data);
    return;
  }

  const choice = data.choices?.[0];
  const rawText = choice?.message?.content || choice?.text || JSON.stringify(choice || {});
  console.log(`Completion tokens: ${data.usage?.completion_tokens}`);
  console.log(`Total text length: ${rawText.length} chars`);
  console.log("\n--- RAW TEXT SAMPLE (first 1000 chars) ---");
  console.log(rawText.slice(0, 1000));

  if (rawText.includes('<|channel|>final')) {
    console.log("\n>>> SUCCESS! Found <|channel|>final! <<<");
    const parts = rawText.split('<|channel|>final');
    console.log("\n--- ANALYSIS PART (first 500 chars) ---");
    console.log(parts[0].slice(0, 500));
    console.log("\n--- FINAL PART (first 1000 chars) ---");
    console.log(parts[1].slice(0, 1000));
  } else {
    console.log("\nDid not find <|channel|>final. Last 500 chars:");
    console.log(rawText.slice(-500));
  }
}

test().catch(console.error);
