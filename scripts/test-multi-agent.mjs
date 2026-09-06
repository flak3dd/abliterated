#!/usr/bin/env node
import assert from "node:assert/strict";
function readySubtasks(graph) { const done=new Set(graph.subtasks.filter(s=>s.status==="done").map(s=>s.id)); return graph.subtasks.filter(s=>{ if(s.status!=="pending") return false; return (s.blockers||[]).every(b=>done.has(b)); }); }
function pickNext(graph){ const ready=readySubtasks(graph); const order=["coder","tester","verifier"]; ready.sort((a,b)=>order.indexOf(a.role||"coder")-order.indexOf(b.role||"coder")); return ready[0]||null; }
const g={goal:"x",subtasks:[{id:"a",text:"c",status:"pending",role:"coder"},{id:"b",text:"t",status:"pending",role:"tester",blockers:["a"]}]};
assert.equal(pickNext(g).id,"a");
g.subtasks[0].status="done";
assert.equal(pickNext(g).id,"b");
console.log("test-multi-agent: ok");
