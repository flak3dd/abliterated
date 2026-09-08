#!/usr/bin/env node
/** Spark install package + Diffusers Klein pairing invariants. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const installDir = path.join(root, 'spark-install');
const imageDir = path.join(root, 'spark-image');
const manifest = JSON.parse(fs.readFileSync(path.join(installDir, 'manifest.json'), 'utf8'));

assert.equal(manifest.image.modelId, 'krea2-raw-fp8');
assert.equal(manifest.image.lightModelId, 'flux2-klein-4b');
assert.equal(manifest.image.backend, 'diffusers');
assert.equal(manifest.image.uncensoredOnly, true);
assert.equal(manifest.image.openaiPort, 7860);
assert.ok(!('comfyPort' in manifest.image));

for (const name of ['install.sh', 'start.sh', 'stop.sh', 'status.sh', 'push.sh', 'README.md', 'nvsync/port-7860.bash', 'nvsync/README.md']) {
  assert.ok(fs.existsSync(path.join(installDir, name)), `missing ${name}`);
}
assert.ok(!fs.existsSync(path.join(installDir, 'nvsync', 'port-8188.bash')));
assert.ok(!fs.existsSync(path.join(imageDir, 'comfy_client.py')));
assert.ok(!fs.existsSync(path.join(imageDir, 'serve-comfy.sh')));
assert.ok(!fs.existsSync(path.join(imageDir, 'workflows')));

const installSh = fs.readFileSync(path.join(installDir, 'install.sh'), 'utf8');
assert.match(installSh, /krea2-raw-fp8/);
assert.doesNotMatch(installSh, /ComfyUI\/main\.py|serve-comfy|COMFY_ROOT/);

const startSh = fs.readFileSync(path.join(installDir, 'start.sh'), 'utf8');
assert.match(startSh, /serve-spark\.sh/);
assert.match(startSh, /7860/);
assert.doesNotMatch(startSh, /serve-comfy|COMFY_/);
assert.doesNotMatch(startSh, /:8188/);

const stopSh = fs.readFileSync(path.join(installDir, 'stop.sh'), 'utf8');
assert.doesNotMatch(stopSh, /ComfyUI\/main\.py|comfy\.pid/);

const statusSh = fs.readFileSync(path.join(installDir, 'status.sh'), 'utf8');
assert.match(statusSh, /7860/);
assert.doesNotMatch(statusSh, /8188/);

const envExample = fs.readFileSync(path.join(installDir, 'env.example'), 'utf8');
assert.match(envExample, /FLUX_MODEL_ID=krea2-raw-fp8/);
assert.match(envExample, /SAMPLER_BACKEND=diffusers/);
assert.doesNotMatch(envExample, /COMFY_|CIVITAI_/);

const composeSpark = fs.readFileSync(path.join(imageDir, 'docker-compose.spark.yml'), 'utf8');
assert.match(composeSpark, /krea2-raw-fp8/);
assert.doesNotMatch(composeSpark, /COMFY_|8188/);

const pullSh = fs.readFileSync(path.join(imageDir, 'pull-models.sh'), 'utf8');
assert.match(pullSh, /hf download|huggingface-cli/);
assert.match(pullSh, /Quality=krea2-raw-fp8/);
assert.doesNotMatch(pullSh, /civitai\.com|CIVITAI_API|COMFY_ROOT/);

const sync7860 = fs.readFileSync(path.join(installDir, 'nvsync', 'port-7860.bash'), 'utf8');
assert.match(sync7860, /serve-spark\.sh/);
assert.match(sync7860, /krea2-raw-fp8/);
assert.doesNotMatch(sync7860, /serve-comfy/);

const pushSh = fs.readFileSync(path.join(installDir, 'push.sh'), 'utf8');
assert.match(pushSh, /rsync/);

const bridge = fs.readFileSync(path.join(imageDir, 'serve-openai-bridge.py'), 'utf8');
assert.match(bridge, /diffusers/i);
assert.doesNotMatch(bridge, /import comfy_client|COMFY_URL =|from comfy_client/);

const qwenCompose = fs.readFileSync(path.join(root, 'spark', 'docker-compose.qwen-abliterated.yml'), 'utf8');
assert.match(qwenCompose, /qwen-abliterated/);
assert.match(qwenCompose, /ENTRYPOINT is already/);
const qwenServe = fs.readFileSync(path.join(root, 'spark', 'serve-qwen-abliterated.sh'), 'utf8');
assert.match(qwenServe, /entrypoint is vllm serve/);
assert.match(qwenServe, /HF_TOKEN/);
const nvsync8000 = fs.readFileSync(path.join(installDir, 'nvsync', 'port-8000.bash'), 'utf8');
assert.match(nvsync8000, /serve-qwen-abliterated\.sh/);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.ok((pkg.build?.extraResources || []).some((e) => e.from === 'spark-install' && e.to === 'spark-install'));

execFileSync('python3', ['-c', 'from spark_models import QUALITY_MODEL_ID, LIGHT_MODEL_ID, resolve_model_id; assert QUALITY_MODEL_ID=="krea2-raw-fp8"; assert resolve_model_id("hero")=="krea2-raw-fp8"; assert resolve_model_id("klein")=="flux2-klein-9b"; assert resolve_model_id("draft")=="z-image-turbo-nsfw-nvfp4"'], { cwd: imageDir, stdio: 'inherit' });
execFileSync('python3', ['test_uncensored_flux.py'], { cwd: imageDir, stdio: 'inherit' });

const outDir = path.join(root, 'dist-test-spark-install');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync('node_modules/.bin/tsc', ['src/lib/sparkInstall.ts', 'src/types/index.ts', '--outDir', outDir, '--module', 'esnext', '--target', 'es2022', '--moduleResolution', 'bundler', '--strict'], { cwd: root, stdio: 'inherit' });
const mod = await import(pathToFileURL(path.join(outDir, 'lib', 'sparkInstall.js')).href);
assert.equal(mod.UNCENSORED_IMAGE_MODEL, 'krea2-raw-fp8');
assert.equal(mod.resolveSparkImageModel('quality'), 'krea2-raw-fp8');
assert.equal(mod.resolveSparkImageModel('draft'), 'z-image-turbo-nsfw-nvfp4');
assert.equal(typeof mod.sparkComfyUrl, 'undefined');
assert.equal(mod.sparkImageUrl({ sparkLanHost: '192.168.4.101' }), 'http://192.168.4.101:7860/v1');
assert.equal(mod.sparkImageSettingsPatch({ sparkLanHost: '192.168.4.101' }).imageModel, 'krea2-raw-fp8');
assert.equal(mod.SPARK_CHAT_MODEL, 'qwen-abliterated');
console.log('test-spark-install ok');
