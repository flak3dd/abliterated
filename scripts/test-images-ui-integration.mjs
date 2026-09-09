#!/usr/bin/env node
/**
 * UI↔bridge integration probe (no Electron).
 * Assumes NVIDIA Sync / ssh tunnel: Mac localhost:7860 → Spark bridge.
 */
const base = (process.env.ABLITERATED_IMAGE_BASE || 'http://127.0.0.1:7860/v1').replace(/\/$/, '');
const healthBase = base.replace(/\/v1$/, '');

const chips = {
  'New still': 'krea2-raw-fp8',
  'Fast still': 'krea2-turbo',
  'Draft sketch': 'z-image-turbo-nsfw-nvfp4',
  'From text': 'qwen-image-2512-fp8',
  'Edit photo': 'qwen-edit-2511-fp8',
  'Klein still': 'flux2-klein-9b',
};

async function main() {
  const modelsRes = await fetch(`${base}/models`);
  if (!modelsRes.ok) throw new Error(`/models HTTP ${modelsRes.status}`);
  const body = await modelsRes.json();
  let available = Array.isArray(body.available) ? body.available : null;
  if (!available?.length) {
    const h = await fetch(`${healthBase}/health`);
    const hb = await h.json();
    available = hb.availableModels || [];
  }
  console.log('available', available);
  const expectOn = ['New still', 'Draft sketch', 'From text', 'Edit photo'];
  const expectOff = ['Fast still', 'Klein still'];
  for (const name of expectOn) {
    const id = chips[name];
    if (!available.includes(id)) throw new Error(`${name} (${id}) should be enabled`);
    console.log(`chip ${name}: ENABLED`);
  }
  for (const name of expectOff) {
    const id = chips[name];
    if (available.includes(id)) throw new Error(`${name} (${id}) should be muted`);
    console.log(`chip ${name}: muted`);
  }
  // Quality already e2e'd; Draft PNG optional check via env
  console.log('UI_INTEGRATION_OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
