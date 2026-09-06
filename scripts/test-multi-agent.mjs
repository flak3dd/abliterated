#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "dist-test-multi-agent");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  "npx",
  [
    "tsc",
    "src/lib/writeLocks.ts",
    "src/lib/replanTriggers.ts",
    "src/lib/goalKeeper.ts",
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

function readySubtasks(graph) {
  const done = new Set(graph.subtasks.filter((s) => s.status === "done").map((s) => s.id));
  return graph.subtasks.filter((s) => {
    if (s.status !== "pending") return false;
    return (s.blockers || []).every((b) => done.has(b));
  });
}
function pickNext(graph) {
  const ready = readySubtasks(graph);
  const order = ["coder", "tester", "verifier"];
  ready.sort((a, b) => order.indexOf(a.role || "coder") - order.indexOf(b.role || "coder"));
  return ready[0] || null;
}

const g = {
  goal: "x",
  subtasks: [
    { id: "a", text: "c", status: "pending", role: "coder" },
    { id: "b", text: "t", status: "pending", role: "tester", blockers: ["a"] },
  ],
};
assert.equal(pickNext(g).id, "a");
g.subtasks[0].status = "done";
assert.equal(pickNext(g).id, "b");

const wl = await import(pathToFileURL(path.join(outDir, "writeLocks.js")).href);
const rp = await import(pathToFileURL(path.join(outDir, "replanTriggers.js")).href);
const gk = await import(pathToFileURL(path.join(outDir, "goalKeeper.js")).href);

let table = {};
const c1 = wl.claimWritePath(table, "src/a.ts", "w1", "n1");
assert.equal(c1.ok, true);
assert.equal(wl.claimWritePath(c1.table, "src/a.ts", "w2", "n2").ok, false);
assert.equal(rp.shouldReplanOnVerifyFails(2), true);
assert.equal(
  gk.goalKeeperCheck({
    originalGoal: "Add auth middleware tests",
    graphGoal: "Add auth middleware tests",
    evidenceText: "auth middleware tests green",
  }).ok,
  true,
);
console.log("test-multi-agent: ok");
