import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const redundantFiles = [
  // Obsolete doc generation and patching scripts
  'scripts/add_chunk.py',
  'scripts/app_lines.jsonl',
  'scripts/assemble_app.py',
  'scripts/extra.md',
  'scripts/fill_app.sh',
  'scripts/fix_vite_docs_mw.py',
  'scripts/from_hex.py',
  'scripts/gen_app_docs.py',
  'scripts/gen_rest.py',
  'scripts/patch_quickstart.py',
  'scripts/patch_readme.py',
  'scripts/patch_settings_docs.py',
  'scripts/patch_vite_docs.py',
  'scripts/patch_vite_docs_mw.py',
  'scripts/push_md.py',
  'scripts/strip_docs_redirect.py',

  // Obsolete debug and probe scripts
  'scripts/dbg_cache.mjs',
  'scripts/dbg_jsonl.mjs',
  'scripts/dbg_stdio.mjs',
  'scripts/dbg_stdio2.mjs',
  'scripts/mcp_fs_verify.mjs',
  'scripts/mcp_ws_verify.mjs',
  'scripts/peek_fs.mjs',
  'scripts/peek_stdio_sdk.mjs',
  'scripts/read_sdk_stdio.mjs',
  'scripts/sdk_stdio_out.txt',
  'scripts/test-probe-p3.mjs',
  'scripts/test-probe-p3-exact.mjs',
  'scripts/add-skip-lib-check.mjs',
];

console.log('Cleaning up redundant files...');
let removedCount = 0;
for (const relPath of redundantFiles) {
  const absPath = path.join(root, relPath);
  if (fs.existsSync(absPath)) {
    fs.unlinkSync(absPath);
    console.log(`Deleted: ${relPath}`);
    removedCount++;
  } else {
    console.log(`Already absent: ${relPath}`);
  }
}

// Clean ephemeral test build directories in root if they exist
const ephemeralDirs = [
  'dist-test-build',
  'dist-test-eval-fixtures',
  'dist-test-image-prompt',
  'dist-test-multi-agent',
  'dist-test-spark-install',
  'dist-test-vdone',
];

for (const dir of ephemeralDirs) {
  const absDir = path.join(root, dir);
  if (fs.existsSync(absDir)) {
    fs.rmSync(absDir, { recursive: true, force: true });
    console.log(`Deleted ephemeral dir: ${dir}`);
  }
}

console.log(`\nCleanup complete: ${removedCount} files removed.`);
