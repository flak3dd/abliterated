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
  await checkHost(h);
}
