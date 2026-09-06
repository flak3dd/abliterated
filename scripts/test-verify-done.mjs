#!/usr/bin/env node
import assert from "node:assert/strict";
function looksLikeVerifyEvidence(text, toolsUsed) { if (toolsUsed && toolsUsed.indexOf("verify") >= 0) return true; return false; }
function buildIncompleteCapNote(n) { return "Incomplete turns " + String(n); }
assert.equal(looksLikeVerifyEvidence("", ["verify"]), true);
assert.equal(looksLikeVerifyEvidence("hi", ["shell"]), false);
assert.ok(buildIncompleteCapNote(24).includes("24"));
console.log("test-verify-done: ok");
