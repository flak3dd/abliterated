#!/usr/bin/env node
/** Unit smoke for xAI Imagine helpers — run: node scripts/test-xai-image.mjs */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-xai-image');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  'node_modules/.bin/tsc',
  [
    'src/lib/xaiImage.ts',
    '--outDir',
    outDir,
    '--rootDir',
    'src',
    '--module',
    'esnext',
    '--target',
    'es2022',
    '--moduleResolution',
    'bundler',
    '--strict',
    '--skipLibCheck',
  ],
  { cwd: root, stdio: 'inherit' },
);
const {
  XAI_IMAGE_MODEL,
  isXaiImageBackend,
  sizeToXaiAspectRatio,
  buildXaiImageBody,
  xaiImageRequestPath,
  xaiDevProxyPath,
  dataUrlFromB64,
  xaiImageSettingsPatch,
  resolveXaiImageModel,
  looksLikeXaiImageModel,
} = await import(pathToFileURL(path.join(outDir, 'lib/xaiImage.js')).href);

assert.equal(isXaiImageBackend({ imageBackend: 'xai' }), true);
assert.equal(isXaiImageBackend({ imageBackend: 'spark' }), false);
assert.equal(sizeToXaiAspectRatio('1024x1024'), '1:1');
assert.equal(sizeToXaiAspectRatio('1920x1080'), '16:9');
assert.equal(sizeToXaiAspectRatio('768x1024'), '3:4');

assert.equal(looksLikeXaiImageModel('grok-imagine-image-2.0'), true);
assert.equal(looksLikeXaiImageModel('krea2-raw-fp8'), false);
assert.equal(looksLikeXaiImageModel('qwen-edit-2511-fp8'), false);
assert.equal(resolveXaiImageModel('krea2-raw-fp8', 'grok-imagine-image-2.0'), XAI_IMAGE_MODEL);
assert.equal(resolveXaiImageModel('qwen-edit-2511-fp8'), XAI_IMAGE_MODEL);
assert.equal(resolveXaiImageModel('grok-imagine-image-2.0'), XAI_IMAGE_MODEL);

const gen = buildXaiImageBody({ prompt: 'a cat', size: '1024x1024', n: 1, model: 'krea2-raw-fp8' });
assert.equal(gen.model, XAI_IMAGE_MODEL);
assert.equal(gen.response_format, 'b64_json');
assert.equal(gen.aspect_ratio, '1:1');
assert.equal(gen.resolution, '2k');
assert.equal(xaiImageRequestPath(gen), '/images/generations');
assert.equal(gen.image, undefined);
assert.equal(gen.images, undefined);

const jpeg = 'aaaa';
const edit = buildXaiImageBody({ prompt: 'edit', imageB64s: [jpeg], resolution: '1k', model: 'qwen-edit-2511-fp8' });
assert.equal(edit.model, XAI_IMAGE_MODEL);
assert.equal(edit.resolution, '1k');
assert.equal(xaiImageRequestPath(edit), '/images/edits');
assert.ok(edit.image && !Array.isArray(edit.image) && String(edit.image.url).startsWith('data:'));
assert.equal(edit.images, undefined);

const multi = buildXaiImageBody({ prompt: 'id', imageB64s: ['aaa', 'bbb'] });
assert.equal(xaiImageRequestPath(multi), '/images/edits');
assert.ok(Array.isArray(multi.images) && multi.images.length === 2);
assert.equal(multi.image, undefined);
assert.equal(multi.images[0].type, 'image_url');

assert.equal(xaiDevProxyPath('https://api.x.ai/v1/images/generations'), '/xai-v1/images/generations');
assert.equal(dataUrlFromB64('iVBORw0KGgo'), 'data:image/png;base64,iVBORw0KGgo');

const patch = xaiImageSettingsPatch({ xaiImageBaseUrl: '', xaiImageModel: '', xaiImageResolution: '1k' });
assert.equal(patch.imageBackend, 'xai');
assert.equal(patch.imageGenEnabled, true);
assert.equal(patch.xaiImageModel, XAI_IMAGE_MODEL);
assert.equal(patch.imageBaseUrl, undefined);
assert.equal(patch.imageToken, undefined);

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-xai-image.mjs ok');
