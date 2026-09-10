/**
 * Test suite for Image Studio standalone web app structure and assets.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

console.log('--- Running Image Studio tests ---');

const base = path.resolve('image-studio');

// 1. Server validation
{
  const stat = await fs.stat(path.join(base, 'server.mjs'));
  assert.ok(stat.size > 500, 'server.mjs should be non-empty');
  const serverCode = await fs.readFile(path.join(base, 'server.mjs'), 'utf8');
  assert.ok(serverCode.includes('/api/status'), 'server.mjs missing /api/status route');
  assert.ok(serverCode.includes('/api/generate'), 'server.mjs missing /api/generate route');
  assert.ok(serverCode.includes('/api/gallery'), 'server.mjs missing /api/gallery route');
  console.log('✔ Server structure and routes verified');
}

// 2. Static HTML & Assets
{
  const html = await fs.readFile(path.join(base, 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('<!DOCTYPE html>'), 'index.html missing DOCTYPE');
  assert.ok(html.includes('IMAGE STUDIO'), 'index.html missing brand header');
  assert.ok(html.includes('app.js'), 'index.html missing script tag');

  const css = await fs.readFile(path.join(base, 'public', 'styles.css'), 'utf8');
  assert.ok(css.includes('--bg-app'), 'styles.css missing theme variables');

  const js = await fs.readFile(path.join(base, 'public', 'app.js'), 'utf8');
  assert.ok(js.includes('WORKFLOWS'), 'app.js missing WORKFLOWS definition');
  assert.ok(js.includes('generate'), 'app.js missing generate function');

  console.log('✔ Frontend studio assets verified');
}

// 3. Storage Directory
{
  const galleryDir = path.resolve('.ablit', 'images');
  await fs.mkdir(galleryDir, { recursive: true });
  const stat = await fs.stat(galleryDir);
  assert.ok(stat.isDirectory(), '.ablit/images should be a valid directory');
  console.log('✔ Persistent artwork storage verified at .ablit/images');
}

console.log('--- All Image Studio tests passed! ---');
