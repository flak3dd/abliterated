#!/usr/bin/env node
/** Spark install package + Krea/Z-Image pairing invariants. */
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

assert.equal(manifest.image.modelId, 'krea2-turbo-nvfp4');
assert.equal(manifest.image.draftModelId, 'z-image-turbo-nsfw-nvfp4');
assert.equal(manifest.image.uncensoredOnly, true);
assert.ok(manifest.image.forbiddenCheckpoints.includes('DreamShaper_8_pruned.safetensors'));

for (const name of ['install.sh', 'start.sh', 'stop.sh', 'status.sh', 'push.sh', 'README.md', 'nvsync/port-8188.bash', 'nvsync/port-7860.bash', 'nvsync/README.md']) {
  const p = path.join(installDir, name);
  assert.ok(fs.existsSync(p), `missing ${name}`);
}

const installSh = fs.readFileSync(path.join(installDir, 'install.sh'), 'utf8');
assert.match(installSh, /krea2-turbo-nvfp4/);
assert.match(installSh, /z-image-turbo-nsfw-nvfp4/);
assert.doesNotMatch(installSh, /DreamShaper_8_pruned/);

const pullSh = fs.readFileSync(path.join(imageDir, 'pull-models.sh'), 'utf8');
assert.match(pullSh, /krea2_turbo_nvfp4\.safetensors/);
assert.match(pullSh, /z_image_turbo_nvfp4\.safetensors/);
assert.match(pullSh, /krea2_uncensor\.safetensors/);
assert.match(pullSh, /Huihui-Qwen3-VL-4B-Instruct-abliterated/);

const sync8188 = fs.readFileSync(path.join(installDir, 'nvsync', 'port-8188.bash'), 'utf8');
assert.match(sync8188, /serve-comfy\.sh/);
assert.match(sync8188, /trap cleanup/);
const sync7860 = fs.readFileSync(path.join(installDir, 'nvsync', 'port-7860.bash'), 'utf8');
assert.match(sync7860, /serve-spark\.sh/);
assert.match(sync7860, /krea2-turbo-nvfp4/);

const pushSh = fs.readFileSync(path.join(installDir, 'push.sh'), 'utf8');
assert.match(pushSh, /rsync/);
assert.match(pushSh, /--exclude '\.venv'/);

const krea = JSON.parse(
  fs.readFileSync(path.join(imageDir, 'workflows', 'txt2img-krea2-turbo-nvfp4.json'), 'utf8'),
);
assert.equal(krea['10'].class_type, 'UNETLoader');
assert.equal(krea['10'].inputs.unet_name, 'krea2_turbo_nvfp4.safetensors');
assert.equal(krea['15'].class_type, 'LoraLoaderModelOnly');
assert.equal(krea['15'].inputs.lora_name, 'krea2_uncensor.safetensors');
assert.equal(krea['11'].inputs.type, 'krea2');
assert.equal(krea['15']._meta.title.includes('uncensor'), true);

const genDoc = fs.readFileSync(path.join(imageDir, 'workflows', 'IMAGE_GEN.md'), 'utf8');
assert.match(genDoc, /krea2-turbo-nvfp4/);
assert.match(genDoc, /z-image-turbo-nsfw-nvfp4/);
assert.match(genDoc, /ConditioningZeroOut/);
assert.match(genDoc, /LoraLoaderModelOnly/);
assert.doesNotMatch(genDoc, /DreamShaper_8_pruned/);

const zimg = JSON.parse(
  fs.readFileSync(path.join(imageDir, 'workflows', 'txt2img-zimage-turbo-nvfp4.json'), 'utf8'),
);
assert.equal(zimg['10'].inputs.unet_name, 'z_image_turbo_nvfp4.safetensors');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const extras = pkg.build?.extraResources || [];
assert.ok(
  extras.some((e) => e.from === 'spark-install' && e.to === 'spark-install'),
  'electron extraResources must include spark-install',
);

execFileSync('python3', ['-c', 'from spark_models import QUALITY_MODEL_ID, DRAFT_MODEL_ID, resolve_model_id; assert QUALITY_MODEL_ID=="krea2-turbo-nvfp4"; assert resolve_model_id("draft")=="z-image-turbo-nsfw-nvfp4"; assert resolve_model_id("comfy-dreamshaper")=="krea2-turbo-nvfp4"'], {
  cwd: imageDir,
  stdio: 'inherit',
});
execFileSync('python3', ['test_uncensored_flux.py'], { cwd: imageDir, stdio: 'inherit' });

const outDir = path.join(root, 'dist-test-spark-install');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  'node_modules/.bin/tsc',
  [
    'src/lib/sparkInstall.ts',
    'src/types/index.ts',
    '--outDir',
    outDir,
    '--module',
    'esnext',
    '--target',
    'es2022',
    '--moduleResolution',
    'bundler',
    '--strict',
  ],
  { cwd: root, stdio: 'inherit' },
);
const mod = await import(pathToFileURL(path.join(outDir, 'lib', 'sparkInstall.js')).href);
assert.equal(mod.UNCENSORED_IMAGE_MODEL, 'krea2-turbo-nvfp4');
assert.equal(mod.DRAFT_IMAGE_MODEL, 'z-image-turbo-nsfw-nvfp4');
assert.equal(mod.resolveSparkImageModel('draft'), 'z-image-turbo-nsfw-nvfp4');
assert.equal(mod.resolveSparkImageModel('abliterated-flux-klein'), 'krea2-turbo-nvfp4');
assert.equal(mod.sparkLanHost({ sparkLanHost: '' }), '127.0.0.1');
assert.equal(mod.sparkImageUrl({ sparkLanHost: '192.168.4.101' }), 'http://192.168.4.101:7860/v1');
const patch = mod.sparkImageSettingsPatch({ sparkLanHost: '192.168.4.101' });
assert.equal(patch.imageModel, 'krea2-turbo-nvfp4');
assert.equal(patch.imageViaProxy, false);
const draft = mod.sparkImageSettingsPatch({ sparkLanHost: '192.168.4.101' }, 'draft');
assert.equal(draft.imageModel, 'z-image-turbo-nsfw-nvfp4');
assert.match(mod.sparkPushCommand('gx10'), /push\.sh gx10/);

console.log('test-spark-install ok');
