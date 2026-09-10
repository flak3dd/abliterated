// Quick test for /api/benchmark/config and /benchmark
async function test() {
  const res = await fetch('http://127.0.0.1:5173/api/benchmark/config');
  console.log('HTTP /api/benchmark/config status:', res.status);
  const data = await res.json();
  console.log('Prompts count:', data.prompts?.length, '| Models count:', data.models?.length);

  const htmlRes = await fetch('http://127.0.0.1:5173/benchmark');
  console.log('HTTP /benchmark status:', htmlRes.status);
  const html = await htmlRes.text();
  console.log('HTML title present:', html.includes('Abliterated Benchmark Workbench'));
}

test().catch(console.error);
