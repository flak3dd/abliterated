#!/usr/bin/env node
import assert from "node:assert/strict";
function emptyTaskGraph(goal = "") { return { version: 1, goal: goal.trim(), subtasks: [], updatedAt: Date.now() }; }
const g0 = emptyTaskGraph("Ship Tier-1");
assert.equal(g0.goal, "Ship Tier-1");
assert.equal(g0.subtasks.length, 0);
console.log("test-task-graph: ok");
