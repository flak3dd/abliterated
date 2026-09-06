#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-task-graph');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  'npx',
  [
    'tsc',
    'src/lib/hierarchicalTaskGraph.ts',
    '--outDir',
    outDir,
    '--rootDir',
    'src/lib',
    '--module',
    'esnext',
    '--target',
    'es2022',
    '--moduleResolution',
    'bundler',
    '--strict',
  ],
  { cwd: root, stdio: 'inherit' },
);
const g = await import(pathToFileURL(path.join(outDir, 'hierarchicalTaskGraph.js')).href);

let graph = g.createTaskGraph({
  goal: 'Add auth middleware and tests',
  success_criteria: ['JWT middleware exists', 'unit tests pass'],
  global_budgets: { max_parallel_agents: 2, max_total_tokens: 200000 },
});
assert.equal(graph.status, 'pending');
assert.equal(graph.success_criteria.length, 2);

const a = g.addNode(graph, {
  description: 'Decompose auth',
  role_hint: 'researcher',
  budget: { max_steps: 20, max_tokens: 40000 },
});
graph = a.graph;
const t1 = a.node.id;

const b = g.addNode(graph, {
  description: 'Implement JWT middleware',
  role_hint: 'coder',
  depends_on: [t1],
  budget: { max_steps: 40, max_tokens: 120000 },
});
graph = b.graph;
const t2 = b.node.id;

assert.equal(g.readyNodes(graph).map((n) => n.id).join(), t1);
assert.equal(g.nodeCanStart(graph, t2), false);

graph = g.assignNode(graph, t1, 'researcher-1');
graph = g.startNode(graph, t1);
graph = g.addArtifact(graph, t1, {
  type: 'analysis',
  path: 'auth_design.md',
  summary: 'auth design',
  produced_by: 'researcher-1',
});

assert.throws(() => g.assignNode(graph, t2, 'coder-1'), /not ready/);

graph = g.verifyNode(graph, t1, { status: 'pass', method: 'critic', by: 'critic-1' });
assert.equal(graph.nodes.find((n) => n.id === t1).status, 'completed');
assert.equal(g.nodeCanStart(graph, t2), true);

graph = g.assignNode(graph, t2, 'coder-1');
const spent = g.consumeBudget(graph, t2, { steps: 41, tokens: 10 });
assert.equal(spent.exceeded, true);
graph = spent.graph;

const bad = g.safeParseTaskGraph({ graph_id: 'x', original_goal: 'no' });
assert.equal(bad.ok, false);

const cycleTry = g.safeParseTaskGraph({
  graph_id: 'tg_cycle01_aaaa',
  created_at: new Date().toISOString(),
  version: 1,
  original_goal: 'cycle',
  success_criteria: ['x'],
  status: 'running',
  nodes: [
    {
      id: 'tn_aaaaaaa1',
      description: 'a',
      status: 'pending',
      created_at: new Date().toISOString(),
      depends_on: ['tn_aaaaaaa2'],
    },
    {
      id: 'tn_aaaaaaa2',
      description: 'b',
      status: 'pending',
      created_at: new Date().toISOString(),
      depends_on: ['tn_aaaaaaa1'],
    },
  ],
});
assert.equal(cycleTry.ok, false);
assert.match(cycleTry.error, /cycle/i);

fs.rmSync(outDir, { recursive: true, force: true });

// reclaim + path locks + default budget
{
  let g2 = g.createTaskGraph({ goal: 'reclaim fixture', success_criteria: ['ok'] });
  const n = g.addNode(g2, { description: 'coder', role_hint: 'coder', budget: g.defaultNodeBudget('coder') });
  g2 = n.graph;
  assert.equal(n.node.budget.max_steps, 16);
  g2 = g.assignNode(g2, n.node.id, 'c1');
  g2 = g.startNode(g2, n.node.id);
  g2 = {
    ...g2,
    nodes: g2.nodes.map((node) =>
      node.id === n.node.id
        ? { ...node, started_at: new Date(Date.now() - 200000).toISOString(), metadata: { lastBeatAt: Date.now() - 200000, lockPath: 'src/x.ts' } }
        : node,
    ),
  };
  const rec = g.reclaimStaleNodes(g2, 90000);
  assert.ok(rec.reclaimed.includes(n.node.id));
  assert.equal(g.canClaimWritePath(g2, 'src/x.ts', 'other'), false);
}

console.log('test-task-graph: ok');
