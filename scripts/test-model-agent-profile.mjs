#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "dist-test-model-agent-profile");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  "node_modules/.bin/tsc",
  [
    "src/lib/modelAgentProfile.ts",
    "src/lib/modelSettingsGuide.ts",
    "src/lib/featherlessQwen.ts",
    "--outDir",
    outDir,
    "--rootDir",
    "src/lib",
    "--module",
    "esnext",
    "--target",
    "es2022",
    "--moduleResolution",
    "bundler",
    "--strict",
  ],
  { cwd: root, stdio: "inherit" },
);
const { buildModelAgentProfile } = await import(
  pathToFileURL(path.join(outDir, "modelAgentProfile.js")).href
);

const qwen = buildModelAgentProfile({
  model: "Qwen/Qwen3-32B",
  provider: "featherless",
  reasoning: "max",
  toolUse: true,
  contextLength: 32768,
  buildMode: true,
});
assert.equal(qwen.family, "thinking");
assert.equal(qwen.toolTier, "full");
assert.equal(qwen.compactPrompt, false);
assert.equal(qwen.sendTools, true);
assert.equal(qwen.useThoughtLock, true);
assert.ok(qwen.toolNames.includes("shell") || qwen.toolNames.includes("read_file"));
assert.ok(qwen.toolNames.includes("write_file"));
const core = buildModelAgentProfile({
  model: "Qwen/Qwen3-8B",
  provider: "featherless",
  toolUse: true,
  contextLength: 8192,
  buildMode: true,
});
assert.equal(core.toolTier, "core");
assert.ok(core.toolNames.includes("verify"));
assert.ok(core.toolNames.includes("shell"));
assert.ok(core.toolNames.includes("read_skill"));
assert.ok(core.toolNames.includes("suggest_skill"));
assert.ok(qwen.systemAddendum.includes("Thinking model"));

const base = buildModelAgentProfile({
  model: "some-org/raw-base-7b",
  provider: "featherless",
  toolUse: false,
  contextLength: 8192,
});
assert.equal(base.toolTier, "none");
assert.equal(base.sendTools, false);

fs.rmSync(outDir, { recursive: true, force: true });
console.log("test-model-agent-profile: ok");
