#!/usr/bin/env node
/**
 * Lightweight fixture eval for harness sweeps (no live inference).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "dist-test-eval-fixtures");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const files = [
  "src/lib/writeLocks.ts",
  "src/lib/goalKeeper.ts",
  "src/lib/replanTriggers.ts",
  "src/lib/verifyDone.ts",
  "src/lib/hierarchicalTaskGraph.ts",
];
execFileSync(
  "npx",
  [
    "tsc",
    ...files,
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

const wl = await import(pathToFileURL(path.join(outDir, "writeLocks.js")).href);
const gk = await import(pathToFileURL(path.join(outDir, "goalKeeper.js")).href);
const rp = await import(pathToFileURL(path.join(outDir, "replanTriggers.js")).href);
const vd = await import(pathToFileURL(path.join(outDir, "verifyDone.js")).href);
const ht = await import(pathToFileURL(path.join(outDir, "hierarchicalTaskGraph.js")).href);

let table = {};
let c1 = wl.claimWritePath(table, "src/a.ts", "coder-1", "n1");
assert.equal(c1.ok, true);
table = c1.table;
assert.equal(wl.claimWritePath(table, "src/a.ts", "coder-2", "n2").ok, false);
table = wl.releaseWritePath(table, "src/a.ts", "coder-1");
assert.equal(wl.claimWritePath(table, "./src/a.ts", "coder-2", "n2").ok, true);

assert.equal(
  gk.goalKeeperCheck({
    originalGoal: "Add auth middleware and unit tests",
    graphGoal: "Add auth middleware and unit tests",
    evidenceText: "auth middleware jwt unit tests pass",
  }).ok,
  true,
);
assert.equal(
  gk.goalKeeperCheck({
    originalGoal: "Add auth middleware and unit tests",
    graphGoal: "unrelated",
    evidenceText: "listed directories only",
  }).ok,
  false,
);

assert.equal(rp.shouldReplanOnVerifyFails(2), true);
assert.equal(rp.shouldReplanOnBudget(true), true);
assert.equal(rp.shouldReplanOnHeartbeatStall(Date.now() - 200_000, Date.now(), 90_000), true);

assert.equal(vd.coldVerifierRequiresVerify(["shell"]).ok, false);
assert.equal(vd.coldVerifierRequiresVerify(["verify"]).ok, true);

function shouldUseTaskGraph(opts) {
  if (opts.multiAgent) return true;
  if (opts.largeJob || opts.buildProcess) return true;
  return false;
}
function shouldAutoInjectVerifyStrict(opts) {
  return !!(opts.buildProcess || opts.largeJob || opts.verifyStrictProfile);
}
assert.equal(shouldUseTaskGraph({ largeJob: false, buildProcess: false }), false);
assert.equal(shouldUseTaskGraph({ largeJob: true }), true);
assert.equal(shouldAutoInjectVerifyStrict({ buildProcess: true }), true);
assert.equal(shouldAutoInjectVerifyStrict({}), false);

const preset = {
  buildModeEnabled: true,
  skillsEnabled: true,
  deepenCompleteness: true,
  selfDeepenEnabled: true,
  planModeEnabled: false,
  verifyStrictProfile: true,
};
assert.equal(preset.verifyStrictProfile, true);

let graph = ht.createTaskGraph({ goal: "fixture feature", success_criteria: ["tests pass"] });
const a = ht.addNode(graph, {
  description: "coder work",
  role_hint: "coder",
  budget: ht.defaultNodeBudget("coder"),
});
graph = a.graph;
assert.equal(a.node.budget.max_steps, 16);
graph = ht.assignNode(graph, a.node.id, "coder-1");
graph = ht.startNode(graph, a.node.id);
graph = {
  ...graph,
  nodes: graph.nodes.map((n) =>
    n.id === a.node.id
      ? {
          ...n,
          started_at: new Date(Date.now() - 200_000).toISOString(),
          metadata: { lastBeatAt: Date.now() - 200_000, lockPath: "src/x.ts" },
        }
      : n,
  ),
};
assert.equal(ht.canClaimWritePath(graph, "src/x.ts", "other"), false);
const rec = ht.reclaimStaleNodes(graph, 90_000);
assert.ok(rec.reclaimed.includes(a.node.id));

console.log("eval-fixtures: ok");
