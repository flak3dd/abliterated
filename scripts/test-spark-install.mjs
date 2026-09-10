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

const imagesScreen = fs.readFileSync(path.join(root, 'src/screens/ImagesScreen.tsx'), 'utf8');
assert.match(imagesScreen, /isFaceswapPath/);
assert.match(imagesScreen, /isIdPath/);
assert.match(imagesScreen, /intent: 'faceswap'/);
assert.match(imagesScreen, /idImageB64/);
assert.match(imagesScreen, /ID swap/);
assert.match(imagesScreen, /applyIdSection/);
assert.match(imagesScreen, /runIdPipeline/);
assert.match(imagesScreen, /id_portrait/);
assert.match(imagesScreen, /ID document/);
assert.match(imagesScreen, /IMAGE_RATIOS/);
assert.match(imagesScreen, /sizeForRatio/);
assert.match(imagesScreen, /Long edge/);
const imageAspect = fs.readFileSync(path.join(root, 'src/lib/imageAspect.ts'), 'utf8');
assert.match(imageAspect, /sizeFromRatio/);
assert.match(imageAspect, /3:4/);
assert.match(imagesScreen, /slice\(s\.indexOf\(','\) \+ 1\)/);
assert.doesNotMatch(imagesScreen, /split\(',', 1\)\[1\]/);
const imageGen = fs.readFileSync(path.join(root, 'src/lib/imageGen.ts'), 'utf8');
assert.match(imageGen, /idImageB64/);
assert.match(imageGen, /id_image/);
assert.match(imageGen, /id_type/);
assert.match(imageGen, /compactImageB64/);
assert.match(imageGen, /compactFileToDataUrl/);
assert.doesNotMatch(imageGen, /extra\.image = refB64/);
assert.doesNotMatch(imageGen, /extra\.image_b64/);
assert.doesNotMatch(imageGen, /body\.image_b64/);
assert.match(imagesScreen, /compactFileToDataUrl/);
const samplerRt = fs.readFileSync(path.join(imageDir, 'sampler_runtime.py'), 'utf8');
assert.match(samplerRt, /use_vae_tiling/);
assert.match(samplerRt, /inference_mode/);
assert.match(samplerRt, /compress_level=1/);
assert.match(samplerRt, /OutOfMemoryError/);
assert.match(samplerRt, /Never swap processors on DiT/);
assert.match(samplerRt, /want_cpu_offload/);
assert.match(samplerRt, /unload_pipes/);
assert.match(samplerRt, /evicted/);
assert.match(samplerRt, /fit_contain/);
assert.match(samplerRt, /size_from_ratio/);
assert.match(samplerRt, /fit_size_inside/);
assert.match(imagesScreen, /content keeps source ratio/);
assert.match(imagesScreen, /ID\/passport keeps real card ratio/);
assert.match(imagesScreen, /idContentRatio/);
const idPipelineTs = fs.readFileSync(path.join(root, 'src/lib/idPipeline.ts'), 'utf8');
assert.match(idPipelineTs, /composeIdPrompt/);
assert.match(idPipelineTs, /id_portrait/);
assert.match(idPipelineTs, /ID_MIN_EDGE_PX = 800/);
assert.match(idPipelineTs, /Do not add watermarks, VERIFIED stamps/);
assert.match(idPipelineTs, /ID_LOCK_PROMPT/);
assert.match(idPipelineTs, /ID_CAPTURE_PROMPT/);
assert.match(idPipelineTs, /neutral timber surface/);
assert.match(idPipelineTs, /ID_ALTER_PROMPT/);
assert.match(idPipelineTs, /ID_TEMPLATES/);
assert.match(idPipelineTs, /Alteration \(img2img\)/);
assert.match(idPipelineTs, /Australian driver licence/);
assert.match(idPipelineTs, /ID_SELFIE_FROM_LICENCE_PROMPT/);
assert.match(idPipelineTs, /au_licence_selfie/);
assert.match(idPipelineTs, /Licence selfie/);
assert.match(idPipelineTs, /Copy every printed character/);
assert.match(idPipelineTs, /idContentRatio/);
assert.match(idPipelineTs, /85\.6/);
assert.match(idPipelineTs, /ID_3_MM/);
const idPipelinePy = fs.readFileSync(path.join(imageDir, 'id_pipeline.py'), 'utf8');
assert.match(idPipelinePy, /compose_id_prompt/);
assert.match(idPipelinePy, /id_portrait/);
assert.match(idPipelinePy, /MIN_EDGE_PX = 800/);
assert.match(idPipelinePy, /ID_MIN_EDGE_PX = MIN_EDGE_PX/);
assert.match(idPipelinePy, /id_low_res = low_res/);
assert.match(idPipelinePy, /id_content_ratio/);
assert.match(idPipelinePy, /85\.60/);
assert.match(idPipelinePy, /ID_3_MM/);
assert.match(idPipelinePy, /ID_LOCK_PROMPT/);
assert.match(idPipelinePy, /ID_CAPTURE_PROMPT/);
assert.match(idPipelinePy, /neutral timber surface/);
assert.match(idPipelinePy, /ID_ALTER_PROMPT/);
assert.match(idPipelinePy, /Australian driver licence/);
assert.match(idPipelinePy, /ID_SELFIE_FROM_LICENCE_PROMPT/);
assert.match(idPipelinePy, /ALTER_LOOKS/);
assert.match(imagesScreen, /timber \+ phone camera|real phone photo on timber/);
assert.match(imagesScreen, /Run alteration/);
assert.match(imagesScreen, /Run licence selfie/);
assert.match(imagesScreen, /runIdLicenceSelfie/);
assert.match(imagesScreen, /ID_TEMPLATES/);
assert.match(idPipelinePy, /lock_source_document/);
assert.match(idPipelinePy, /Copy every printed character/);
assert.doesNotMatch(idPipelinePy, /lama\.restore|cycle_gan\.transfer|StyleGAN3|piexif\.remove|api\.abliterated\.ai/);
const bridgePy = fs.readFileSync(path.join(imageDir, 'serve-openai-bridge.py'), 'utf8');
assert.match(bridgePy, /id_image/);
assert.match(bridgePy, /faceswap/);
assert.match(bridgePy, /compose_faceswap_prompt/);
assert.match(bridgePy, /ID_INTENTS/);
assert.match(bridgePy, /compose_id_prompt/);
assert.match(bridgePy, /id_look/);
assert.match(bridgePy, /id_type=id_type if id_job else/);
assert.match(bridgePy, /id_kind=kind if id_job else/);
assert.match(bridgePy, /LOW_RES_INPUT/);
assert.match(samplerRt, /id_type/);
assert.match(samplerRt, /id_content_ratio/);
assert.match(samplerRt, /lock_source_document/);
assert.match(samplerRt, /id_kind/);
assert.match(imagesScreen, /printed text and graphics are copied from the scan/);
assert.match(bridgePy, /\/v1\/health/);
assert.doesNotMatch(bridgePy, /if os\.environ\.get\("SAMPLER_STEPS"/);
assert.doesNotMatch(imageGen, /\|HTTP 503\|/);
assert.match(imagesScreen, /pingImageEndpoint/);
assert.doesNotMatch(imagesScreen, /tiny red square test/);

assert.ok(fs.existsSync(path.join(imageDir, 'spark_ctl.sh')), 'missing spark-image/spark_ctl.sh');
assert.ok(fs.existsSync(path.join(imageDir, 'quality_post.py')), 'missing spark-image/quality_post.py');
const ctl = fs.readFileSync(path.join(imageDir, 'spark_ctl.sh'), 'utf8');
assert.match(ctl, /quality_post\.py/);
assert.match(ctl, /SAMPLER_CPU_OFFLOAD=0/);
assert.doesNotMatch(ctl, /\/tmp\/quality_post\.py/);
const qpost = fs.readFileSync(path.join(imageDir, 'quality_post.py'), 'utf8');
assert.match(qpost, /argparse/);
assert.match(qpost, /krea2-raw-fp8/);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.ok((pkg.build?.extraResources || []).some((e) => e.from === 'spark-install' && e.to === 'spark-install'));

execFileSync('python3', ['-c', 'from spark_models import QUALITY_MODEL_ID, LIGHT_MODEL_ID, resolve_model_id; assert QUALITY_MODEL_ID=="krea2-raw-fp8"; assert resolve_model_id("hero")=="krea2-raw-fp8"; assert resolve_model_id("klein")=="flux2-klein-9b"; assert resolve_model_id("draft")=="z-image-turbo-nsfw-nvfp4"'], { cwd: imageDir, stdio: 'inherit' });
execFileSync('python3', ['test_uncensored_flux.py'], { cwd: imageDir, stdio: 'inherit' });

const outDir = path.join(root, 'dist-test-spark-install');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync('node_modules/.bin/tsc', ['src/lib/sparkInstall.ts', 'src/lib/idPipeline.ts', 'src/lib/imageAspect.ts', 'src/types/index.ts', '--outDir', outDir, '--module', 'esnext', '--target', 'es2022', '--moduleResolution', 'bundler', '--strict',
    '--skipLibCheck', '--lib', 'ES2022,DOM'], { cwd: root, stdio: 'inherit' });
const mod = await import(pathToFileURL(path.join(outDir, 'lib', 'sparkInstall.js')).href);
assert.equal(mod.UNCENSORED_IMAGE_MODEL, 'krea2-raw-fp8');
assert.equal(mod.resolveSparkImageModel('quality'), 'krea2-raw-fp8');
assert.equal(mod.resolveSparkImageModel('draft'), 'z-image-turbo-nsfw-nvfp4');
assert.equal(typeof mod.sparkComfyUrl, 'undefined');
assert.equal(mod.sparkImageUrl({ sparkLanHost: '192.168.4.101' }), 'http://192.168.4.101:7860/v1');
assert.equal(mod.sparkImageSettingsPatch({ sparkLanHost: '192.168.4.101' }).imageModel, 'krea2-raw-fp8');
assert.equal(mod.SPARK_CHAT_MODEL, 'qwen-abliterated');
assert.equal(mod.resolveSparkImageModel('id_portrait'), 'qwen-edit-2511-fp8');
const idp = await import(pathToFileURL(path.join(outDir, 'lib', 'idPipeline.js')).href);
assert.equal(idp.ID_MIN_EDGE_PX, 800);
assert.equal(idp.idIntent('portrait'), 'id_portrait');
assert.equal(idp.lowRes(799, 1200), true);
assert.equal(idp.lowRes(800, 800), false);
const composed = idp.composeIdPrompt({ kind: 'clean', idType: 'passport', country: 'au' });
assert.match(composed, /passport/i);
assert.match(composed, /AU/);
assert.doesNotMatch(composed, /VERIFIED stamp/i);
const aspect = await import(pathToFileURL(path.join(outDir, 'lib', 'imageAspect.js')).href);
assert.equal(aspect.sizeFromRatio(1, 1, 1024), '1024x1024');
assert.equal(aspect.sizeFromRatio(3, 4, 1024), '768x1024');
assert.equal(aspect.sizeFromRatio(16, 9, 1280), '1280x720');
assert.equal(aspect.sizeForRatio('3:4', 1024), '768x1024');
assert.equal(aspect.sizeFromRatio(16, 9, 1920), '1920x1080');
const fit = aspect.fitSizeInside(3, 4, 1920, 1080);
assert.ok(fit.width <= 1920 && fit.height <= 1080);
assert.ok(Math.abs(fit.width / fit.height - 0.75) < 0.02);
console.log('test-spark-install ok');
