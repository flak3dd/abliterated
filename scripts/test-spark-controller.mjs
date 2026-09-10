/**
 * Test suite for the Spark Controller daemon and RPC handlers.
 * Verifies GPU telemetry parsing, recipe catalog, stack actions, and security validations.
 */
import assert from 'node:assert/strict';
import {
  parseGpuCsvLine,
  RECIPES,
  defaultConfig,
  handleVllmCtl,
} from '../daemon/vllmControl.js';

console.log('--- Running Spark Controller tests ---');

// 1. Telemetry parser verification
{
  const sampleSmi = 'NVIDIA DGX B200, 560.35.03, 42, 85, 48, 48200, 192512, 450.5, 700.0';
  const parsed = parseGpuCsvLine(sampleSmi);
  assert.ok(parsed, 'Failed to parse valid nvidia-smi CSV line');
  assert.equal(parsed.name, 'NVIDIA DGX B200');
  assert.equal(parsed.driver, '560.35.03');
  assert.equal(parsed.tempC, 42);
  assert.equal(parsed.gpuUtilPct, 85);
  assert.equal(parsed.memUtilPct, 48);
  assert.equal(parsed.vramUsedMb, 48200);
  assert.equal(parsed.vramTotalMb, 192512);
  assert.equal(parsed.powerDrawW, 450.5);
  assert.equal(parsed.powerLimitW, 700.0);

  // Edge cases
  assert.equal(parseGpuCsvLine(''), null, 'Empty string should yield null');
  assert.equal(parseGpuCsvLine(null), null, 'null input should yield null');
  assert.equal(parseGpuCsvLine('too,few,fields'), null, 'Malformed line (<7 fields) should yield null');
  console.log('✔ GPU telemetry CSV parser verified');
}

// 2. Recipe definitions and default configs
{
  assert.ok(RECIPES.qwen, 'Qwen recipe missing');
  assert.equal(RECIPES.qwen.container, 'qwen-abliterated');
  assert.equal(RECIPES.qwen.quantization, 'nvfp4');

  const qwenDef = defaultConfig('qwen');
  assert.equal(qwenDef.recipe, 'qwen');
  assert.equal(qwenDef.port, 8000);
  assert.equal(qwenDef.gpuMemoryUtilization, 0.6);

  console.log('✔ Recipe catalog and default configurations verified');
}

// 3. handleVllmCtl dispatching
{
  const res = await handleVllmCtl('recipes');
  assert.ok(res.ok, 'handleVllmCtl recipes should return ok: true');
  assert.ok(Array.isArray(res.recipes), 'handleVllmCtl recipes should return array');
  assert.equal(res.recipes.length, 1, 'Should have exactly 1 active recipe (qwen)');

  await assert.rejects(
    async () => {
      await handleVllmCtl('invalid-action-xyz');
    },
    { message: /Unknown vLLM \/ Spark control op/ },
    'handleVllmCtl should reject unknown ops',
  );

  console.log('✔ handleVllmCtl dispatcher and validation verified');
}

// 4. Security: alias validation against injection
{
  await assert.rejects(
    async () => {
      await handleVllmCtl('gpu', { alias: 'flak3dd; rm -rf /' });
    },
    /Invalid SSH alias/,
    'Should reject shell injection in host alias',
  );

  await assert.rejects(
    async () => {
      await handleVllmCtl('gpu', { alias: 'host with spaces' });
    },
    /Invalid SSH alias/,
    'Should reject spaces in host alias',
  );

  console.log('✔ Alias sanitization and command injection defense verified');
}

// 5. Standalone Web App file structure & assets
{
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  const base = path.resolve('spark-controller');
  const serverStat = await fs.stat(path.join(base, 'server.mjs'));
  assert.ok(serverStat.size > 500, 'server.mjs should be non-empty');

  const html = await fs.readFile(path.join(base, 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('<!DOCTYPE html>'), 'index.html missing doctype');
  assert.ok(html.includes('SPARK CONTROLLER'), 'index.html missing brand header');
  assert.ok(html.includes('app.js'), 'index.html missing script tag');

  const css = await fs.readFile(path.join(base, 'public', 'styles.css'), 'utf8');
  assert.ok(css.includes('--bg-app'), 'styles.css missing theme variables');

  const js = await fs.readFile(path.join(base, 'public', 'app.js'), 'utf8');
  assert.ok(js.includes('fetchStatus'), 'app.js missing core fetchStatus');

  console.log('✔ Standalone Spark Controller web app assets verified');
}

console.log('--- All Spark Controller tests passed! ---');
