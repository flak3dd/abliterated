#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "dist-test-vdone");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  "npx",
  [
    "tsc",
    "src/lib/verifyDone.ts",
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
const vd = await import(pathToFileURL(path.join(outDir, "verifyDone.js")).href);
assert.equal(vd.looksLikeVerifyEvidence("", ["verify"]), true);
assert.equal(vd.looksLikeVerifyEvidence("hi", ["shell"]), false);
assert.ok(vd.buildIncompleteCapNote(24).includes("24"));
assert.equal(vd.coldVerifierRequiresVerify(["shell"]).ok, false);
assert.equal(vd.coldVerifierRequiresVerify(["verify"]).ok, true);
assert.ok(vd.buildColdVerifierSystemBlock({ nodeId: "n1" }).includes("Cold-context"));
console.log("test-verify-done: ok");
