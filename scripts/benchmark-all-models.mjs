#!/usr/bin/env node
/**
 * 4-Model Automated Comparative Benchmark Suite with Interchangeable Prompts
 * 
 * Evaluates all four abliterated models across 2 interchangeable prompts:
 * 1. Abliteration Cloud Cluster (`abliterated-model` on api.abliteration.ai)
 * 2. Featherless Cloud API (`medismera/Qwen3.8-27B-OBLITERATED` on api.featherless.ai)
 * 3. Spark GB10 Local Qwen (`qwen-abliterated` on DGX Spark port 8000)
 * 4. Spark GB10 Local GPT-OSS (`gpt-oss-120b-abliterated` on DGX Spark port 8000)
 * 
 * Features:
 * - Interactive prompt entry before each run: Type/paste questions directly, select presets, or pick from the 20-prompt catalog.
 * - Exact prompt count: Runs exactly 2 prompts per model (total 8 evaluations).
 * - Automatic Spark container orchestration: Detects active model, runs it, auto-switches to the second Spark model, and benchmarks both.
 * - Comprehensive reporting: Generates benchmark-all-raw-results.json and benchmark-all-review.md.
 * 
 * Usage:
 *   node scripts/benchmark-all-models.mjs                     # Interactive setup before running
 *   npm run test:benchmark-all                                # Run via npm
 *   node scripts/benchmark-all-models.mjs --preset debugging  # Use debugging preset
 *   node scripts/benchmark-all-models.mjs --prompt1 "..." --prompt2 "..." # Pass custom questions via flags
 *   node scripts/benchmark-all-models.mjs --no-switch         # Benchmark active Spark model without container switch
 *   node scripts/benchmark-all-models.mjs --non-interactive   # Skip interactive wizard (use defaults or flags)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Load environment variables from .env.local
const envFile = path.join(root, '.env.local');
const envVars = {};
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      envVars[k] = v;
    }
  }
}

// Full 20-Prompt Technical Evaluation Catalog
const PROMPT_CATALOG = [
  {
    num: 1,
    id: 'p1_file_watcher_rename',
    category: 'Code generation',
    title: 'Folder Watcher & Date Renamer with Locked File Handling',
    constraints: [
      'Python script watching a folder',
      'Renames new files to YYYY-MM-DD_originalname.ext based on creation date',
      'Include error handling for locked files (PermissionError / in-use retry)',
    ],
    userPrompt: `Write a Python script that watches a folder and renames new files to YYYY-MM-DD_originalname.ext based on creation date. Include error handling for locked files.`,
  },
  {
    num: 2,
    id: 'p2_docker_compose_stack',
    category: 'Code generation',
    title: 'Docker Compose for Node.js, Postgres & Redis',
    constraints: [
      'docker-compose.yml for Node.js app + Postgres + Redis',
      'Must include health checks for all services',
      'Must include persistent volumes for Postgres & Redis',
      'Explain each non-obvious line',
    ],
    userPrompt: `Write a docker-compose.yml for a Node.js app with Postgres and Redis, including health checks and persistent volumes. Explain each non-obvious line.`,
  },
  {
    num: 3,
    id: 'p3_react_data_table_hooks',
    category: 'Code generation',
    title: 'Searchable, Paginated, Sortable Data Table (Hooks Only)',
    constraints: [
      'React component using ONLY hooks (useState, useMemo, etc.)',
      'NO external UI library (no TanStack, no MUI, no Lucide, plain HTML/CSS)',
      'Searchable, paginated, and sortable',
    ],
    userPrompt: `Write a React component for a searchable, paginated, sortable data table using only hooks — no external UI library.`,
  },
  {
    num: 4,
    id: 'p4_nan_form_input_bug',
    category: 'Debugging & error handling',
    title: 'Defensive Fix for NaN in Form Input Math',
    constraints: [
      'Identify root cause of NaN with form inputs',
      'Provide defensive fix handling strings, null, undefined, empty string, commas',
    ],
    userPrompt: `This function sometimes returns NaN when input comes from a form. Find the bug and fix it defensively:

\`\`\`javascript
function calculateInvoiceTotal(subtotal, taxRate, discountAmount, shippingFee) {
  // taxRate comes as percentage e.g. "8.25" or 8.25
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax - discountAmount + shippingFee;
  return Number(total.toFixed(2));
}
\`\`\``,
  },
  {
    num: 5,
    id: 'p5_econnrefused_postgres_ci',
    category: 'Debugging & error handling',
    title: 'ECONNREFUSED 127.0.0.1:5432 in CI Diagnosis',
    constraints: [
      'List likely causes in order of probability',
      'Provide concrete confirmation/diagnostic commands for each',
    ],
    userPrompt: `I get ECONNREFUSED 127.0.0.1:5432 in CI but not locally. List the likely causes in order of probability and how to confirm each.`,
  },
  {
    num: 6,
    id: 'p6_concurrency_limiter',
    category: 'Debugging & error handling',
    title: 'Refactor Async Loop for Max 5 Concurrent Requests',
    constraints: [
      'Max 5 concurrent requests strictly enforced',
      'Refactor the provided rate-limited async loop',
      'Preserve ordering or cleanly return all results',
    ],
    userPrompt: `This async loop fires all requests at once and hits rate limits. Refactor for max 5 concurrent requests:

\`\`\`javascript
async function fetchUserProfiles(userIds) {
  const profiles = await Promise.all(
    userIds.map(async (id) => {
      const res = await fetch(\`https://api.example.com/users/\${id}\`);
      if (!res.ok) throw new Error(\`Failed \${id}: \${res.status}\`);
      return res.json();
    })
  );
  return profiles;
}
\`\`\``,
  },
  {
    num: 7,
    id: 'p7_refactor_monolith_function',
    category: 'Refactoring & code quality',
    title: 'Decompose Monolithic Order Pipeline into Single-Responsibility Units',
    constraints: [
      'Break into smaller units with single responsibilities',
      'Do NOT change runtime behavior',
      'Clear parameter typing and return types',
    ],
    userPrompt: `Refactor this function into smaller units with clear responsibilities, without changing behavior:

\`\`\`javascript
async function processOrder(order, user, paymentDetails) {
  if (!order || !order.items || order.items.length === 0) throw new Error('Invalid order');
  if (!user || !user.email) throw new Error('Invalid user');
  let total = 0;
  for (const item of order.items) {
    if (item.price < 0 || item.qty <= 0) throw new Error('Invalid item: ' + item.id);
    total += item.price * item.qty;
  }
  if (user.isVIP) total *= 0.9;
  const chargeRes = await fetch('https://payment.gateway/charge', {
    method: 'POST',
    body: JSON.stringify({ amount: total, card: paymentDetails.token })
  });
  if (!chargeRes.ok) throw new Error('Payment failed');
  const chargeData = await chargeRes.json();
  await db.query('INSERT INTO orders (id, user_id, total, charge_id) VALUES ($1, $2, $3, $4)', [order.id, user.id, total, chargeData.id]);
  await fetch('https://email.service/send', {
    method: 'POST',
    body: JSON.stringify({ to: user.email, subject: 'Order Confirmed', body: 'Total: ' + total })
  });
  return { success: true, orderId: order.id, chargeId: chargeData.id };
}
\`\`\``,
  },
  {
    num: 8,
    id: 'p8_strategy_pattern_refactor',
    category: 'Refactoring & code quality',
    title: 'Refactor Mixed Responsibilities with Strategy Pattern',
    constraints: [
      'Separate pricing tiers, payment processing, notification dispatch',
      'Apply Strategy Pattern or clean polymorphism',
      'Make adding a new payment processor or pricing tier zero-edit to existing code',
    ],
    userPrompt: `This class mixes three responsibilities (pricing tiers, payment processing, notification dispatch). Refactor it using the Strategy pattern so new tiers or processors can be added without modifying existing code:

\`\`\`typescript
class OrderManager {
  calculateDiscount(tier: string, amount: number): number {
    if (tier === 'basic') return amount;
    if (tier === 'silver') return amount * 0.95;
    if (tier === 'gold') return amount * 0.90;
    return amount;
  }
  async charge(processor: string, amount: number, token: string) {
    if (processor === 'stripe') return await stripeCharge(amount, token);
    if (processor === 'paypal') return await paypalCharge(amount, token);
    throw new Error('Unknown processor');
  }
  async notify(channel: string, user: string, msg: string) {
    if (channel === 'email') await sendEmail(user, msg);
    else if (channel === 'slack') await sendSlack(user, msg);
  }
}
\`\`\``,
  },
  {
    num: 9,
    id: 'p9_strict_typescript_types',
    category: 'Refactoring & code quality',
    title: 'Replace Every `any` with Strict TypeScript Types',
    constraints: [
      'Replace every single `any` with precise types',
      'Use generics, discriminated unions, and mapped types where appropriate',
      'Explain rationale for chosen types',
    ],
    userPrompt: `Add proper TypeScript types to this file, replacing every any and explaining the types you chose:

\`\`\`typescript
function merge(a: any, b: any): any {
  return { ...a, ...b };
}

function handleEvent(event: any) {
  if (event.type === 'click') {
    console.log(event.target.id);
  } else if (event.type === 'keydown') {
    console.log(event.key);
  }
}

async function apiCall(endpoint: string, options?: any): Promise<any> {
  const res = await fetch(endpoint, options);
  return res.json();
}
\`\`\``,
  },
  {
    num: 10,
    id: 'p10_vitest_boundary_large_array',
    category: 'Testing',
    title: 'Vitest Unit Tests with Boundary & Large Array Coverage',
    constraints: [
      'Vitest framework',
      'Cover empty input, null/undefined, and very large arrays (100,000+ items)',
      'Assert performance and correctness',
    ],
    userPrompt: `Write vitest unit tests for this function, covering empty input, null, and very large arrays:

\`\`\`typescript
export function topK(numbers: number[], k: number): number[] {
  if (!numbers || numbers.length === 0 || k <= 0) return [];
  return [...numbers].sort((a, b) => b - a).slice(0, k);
}
\`\`\``,
  },
  {
    num: 11,
    id: 'p11_property_based_testing_fastcheck',
    category: 'Testing',
    title: 'Property-Based Test for Money Rounding with fast-check',
    constraints: [
      'Use fast-check for property-based testing',
      'Identify floating-point rounding edge cases (IEEE 754 precision)',
      'Assert invariants like conservation of cents and monotonicity',
    ],
    userPrompt: `Write a property-based test for a money-rounding function using fast-check, with cases that would catch precision/rounding bugs:

\`\`\`typescript
export function roundToCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}
\`\`\``,
  },
  {
    num: 12,
    id: 'p12_integration_test_mock_db',
    category: 'Testing',
    title: 'API Endpoint Integration Test with Mocked Database',
    constraints: [
      'Test GET /users/:id and POST /users endpoints',
      'Mock database layer cleanly without leaking mocks between tests',
      'State all assumptions clearly',
    ],
    userPrompt: `Write an integration test for this API endpoint with a mocked database layer. State any assumptions:

\`\`\`javascript
app.get('/users/:id', async (req, res) => {
  const user = await db.findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json(user);
});
\`\`\``,
  },
  {
    num: 13,
    id: 'p13_auth_flow_security_audit',
    category: 'Reasoning about code',
    title: 'Trace Full Auth Flow & Identify Security Weaknesses',
    constraints: [
      'Trace session lifecycle from creation to revocation',
      'Identify at least 3 concrete security flaws',
      'Provide immediate remediations for each vulnerability',
    ],
    userPrompt: `Here's my auth module:

\`\`\`javascript
import crypto from 'crypto';
const sessions = new Map();

export function login(userId) {
  const token = crypto.randomBytes(16).toString('hex');
  sessions.set(token, { userId, createdAt: Date.now() });
  return token;
}

export function validate(token) {
  const s = sessions.get(token);
  if (!s) return null;
  return s.userId;
}
\`\`\`

Trace the full lifecycle of a session, identify at least 3 security weaknesses, and fix them.`,
  },
  {
    num: 14,
    id: 'p14_sql_injection_audit',
    category: 'Reasoning about code',
    title: 'SQL Injection Vulnerability Audit & Parameterized Fixes',
    constraints: [
      'Audit every method for SQL injection vulnerabilities',
      'Demonstrate proof-of-concept injection payload for each vulnerable query',
      'Provide secure parameterized rewrite',
    ],
    userPrompt: `Review this data-access layer for SQL injection risk:

\`\`\`javascript
class UserRepository {
  constructor(db) { this.db = db; }
  async findByName(name) {
    return this.db.query(\`SELECT * FROM users WHERE name = '\${name}'\`);
  }
  async findSorted(column, direction) {
    return this.db.query(\`SELECT * FROM users ORDER BY \${column} \${direction}\`);
  }
  async search(query) {
    return this.db.query('SELECT * FROM users WHERE bio LIKE $1', ['%' + query + '%']);
  }
}
\`\`\`

Which queries are vulnerable? Provide attack payloads and rewrite them securely.`,
  },
  {
    num: 15,
    id: 'p15_signature_change_blast_radius',
    category: 'Reasoning about code',
    title: 'Function Signature Change Blast Radius & Caller Analysis',
    constraints: [
      'Analyze blast radius across synchronous and asynchronous callers',
      'Identify backward compatibility breaks',
      'Provide a migration shim supporting both signatures during deprecation',
    ],
    userPrompt: `If I change this function's signature from:
\`sendNotification(recipientId, message, channel = 'email')\`
to:
\`sendNotification({ recipientId, message, channel = 'email', priority = 'normal', metadata = {} })\`

Analyze the blast radius across a codebase with 40+ callers. How do I roll this out safely without breaking existing callers?`,
  },
  {
    num: 16,
    id: 'p16_precommit_and_github_actions',
    category: 'Multi-step / agentic reasoning',
    title: 'Pre-commit Hook (Lint + Typecheck) & Matching GitHub Actions Workflow',
    constraints: [
      'Exact pre-commit hook script (lint-staged + tsc)',
      'Matching GitHub Actions workflow (.github/workflows/ci.yml)',
      'Ensure CI catches anything bypassed by --no-verify',
    ],
    userPrompt: `Give me the exact commands and file contents to set up a pre-commit hook running lint + type-check, and a matching GitHub Actions workflow that runs the exact same checks on pull request.`,
  },
  {
    num: 17,
    id: 'p17_build_time_doubled_diagnosis',
    category: 'Multi-step / agentic reasoning',
    title: 'Build Time Doubled: Diagnosis and Impact-Ranked Fixes',
    constraints: [
      'Rank likely causes by impact and probability',
      'Provide concrete profiling commands (tsc --extendedDiagnostics, bundle analyzer)',
      'Propose quick wins vs structural fixes',
    ],
    userPrompt: `My TypeScript build time doubled from 25s to 55s over the last month in a monorepo. List the most probable root causes ranked by likelihood, how to profile each, and targeted fixes.`,
  },
  {
    num: 18,
    id: 'p18_commonjs_to_esm_migration',
    category: 'Multi-step / agentic reasoning',
    title: 'CommonJS to ESM Migration Plan with Risky Dependencies',
    constraints: [
      'Step-by-step phased migration plan',
      'Handling dual-package hazards, __dirname, and require() in ESM',
      'Rollback strategy if critical dependencies fail under ESM',
    ],
    userPrompt: `Give me a step-by-step migration plan from CommonJS to ESM for a Node.js TypeScript repo with 15 dependencies (some without ESM exports), including configs and risk mitigations.`,
  },
  {
    num: 19,
    id: 'p19_senior_engineer_code_review',
    category: 'Ambiguity & judgment',
    title: 'Senior Engineer Review: "Works But Feels Wrong"',
    constraints: [
      'Identify anti-patterns, memory leaks, concurrency hazards, and maintainability issues',
      'Constructive senior engineer tone with clear architectural recommendations',
      'Refactored clean version',
    ],
    userPrompt: `This code works but feels wrong. Review it like a senior engineer — what would you change and why:

\`\`\`javascript
let cache = {};
async function getData(key, fetcher) {
  if (!cache[key]) {
    cache[key] = await fetcher();
  }
  return cache[key];
}
\`\`\``,
  },
  {
    num: 20,
    id: 'p20_small_saas_architecture',
    category: 'Ambiguity & judgment',
    title: 'Simplest SaaS Architecture (~100 Users) & Scale-Up to 10k Users',
    constraints: [
      'Simplest possible architecture for ~100 users with auth, billing, REST API',
      'Justify each choice (keep it lean, avoid premature optimization)',
      'Detail exact changes needed at 10,000 users',
    ],
    userPrompt: `Propose the simplest architecture for a small SaaS (~100 users) with auth, billing, and a REST API. Justify each choice and note what changes at 10,000 users.`,
  },
];

// Presets mapping to 2 prompt pairs
const PRESETS = {
  codegen: ['p1_file_watcher_rename', 'p2_docker_compose_stack'],
  default: ['p1_file_watcher_rename', 'p2_docker_compose_stack'],
  debugging: ['p4_nan_form_input_bug', 'p6_concurrency_limiter'],
  refactoring: ['p7_refactor_monolith_function', 'p9_strict_typescript_types'],
  testing: ['p10_vitest_boundary_large_array', 'p11_property_based_testing_fastcheck'],
  security: ['p13_auth_flow_security_audit', 'p14_sql_injection_audit'],
  architecture: ['p20_small_saas_architecture', 'p18_commonjs_to_esm_migration'],
  concurrency: ['p6_concurrency_limiter', 'p19_senior_engineer_code_review'],
};

// Model Configurations
function getModelConfigs() {
  const sparkBase = (process.env.SPARK_BASE_URL || envVars.SPARK_BASE_URL || 'http://127.0.0.1:8000/v1').replace(/\/+$/, '');
  const ablitBase = (process.env.VITE_ABLITERATED_BASE_URL || envVars.VITE_ABLITERATED_BASE_URL || 'https://api.abliteration.ai/v1').replace(/\/+$/, '');
  const featherlessBase = (process.env.FEATHERLESS_BASE_URL || envVars.FEATHERLESS_BASE_URL || 'https://api.featherless.ai/v1').replace(/\/+$/, '');

  return [
    {
      id: 'cloud',
      name: 'Abliteration Cloud Cluster',
      shortName: 'Abliterated Cloud',
      env: 'Cloud Cluster (api.abliteration.ai)',
      model: process.env.VITE_ABLITERATED_MODEL || envVars.VITE_ABLITERATED_MODEL || 'abliterated-model',
      baseUrl: ablitBase,
      apiKey: process.env.VITE_ABLITERATED_TOKEN || envVars.VITE_ABLITERATED_TOKEN || '',
      isLocal: false,
      isSpark: false,
      repetitionPenalty: 1.0,
      temperature: 0.3,
    },
    {
      id: 'featherless',
      name: 'Featherless Serverless API',
      shortName: 'Featherless Qwen',
      env: 'Serverless API (api.featherless.ai)',
      model: process.env.FEATHERLESS_MODEL || envVars.FEATHERLESS_MODEL || 'medismera/Qwen3.8-27B-OBLITERATED-Mythos-Class-Agentic',
      baseUrl: featherlessBase,
      apiKey: process.env.FEATHERLESS_API_KEY || envVars.FEATHERLESS_API_KEY || '',
      isLocal: false,
      isSpark: false,
      repetitionPenalty: 1.0,
      temperature: 0.3,
    },
    {
      id: 'spark-gpt',
      name: 'Spark GB10 GPT-OSS 120B Abliterated',
      shortName: 'Spark GPT 120B',
      env: 'NVIDIA GB10 Spark Node (128GB UM)',
      model: process.env.SPARK_GPT_MODEL || 'gpt-oss-120b-abliterated',
      baseUrl: sparkBase,
      apiKey: '',
      isLocal: true,
      isSpark: true,
      containerName: 'gpt-oss-120b-abliterated',
      composeFile: 'docker-compose.gpt-oss-120b-abliterated.yml',
      repetitionPenalty: 1.15, // Essential for MXFP4 quantized MoE stability
      temperature: 0.3,
    },
    {
      id: 'spark-qwen',
      name: 'Spark GB10 Qwen 35B NVFP4 MTP',
      shortName: 'Spark Qwen 35B',
      env: 'NVIDIA GB10 Spark Node (128GB UM)',
      model: process.env.SPARK_QWEN_MODEL || 'qwen-abliterated',
      baseUrl: sparkBase,
      apiKey: '',
      isLocal: true,
      isSpark: true,
      containerName: 'qwen-abliterated',
      composeFile: 'docker-compose.qwen-abliterated.yml',
      repetitionPenalty: 1.0,
      temperature: 0.3,
    },
  ];
}

// Parse Command-line Arguments
function parseCliArgs() {
  const args = process.argv.slice(2);
  const options = {
    preset: 'default',
    prompt1: null,
    prompt2: null,
    prompts: null, // e.g. "p1,p2" or "1,6"
    promptsFile: null,
    models: 'all', // or comma-separated
    autoSwitch: true,
    interactive: null, // null = auto-detect TTY
    nonInteractive: false,
    yes: false,
    output: path.join(root, 'scripts', 'benchmark-all-review.md'),
    resultsJson: path.join(root, 'scripts', 'benchmark-all-raw-results.json'),
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--preset' && args[i + 1]) {
      options.preset = args[++i];
    } else if (arg === '--prompt1' && args[i + 1]) {
      options.prompt1 = args[++i];
    } else if (arg === '--prompt2' && args[i + 1]) {
      options.prompt2 = args[++i];
    } else if (arg === '--prompts' && args[i + 1]) {
      options.prompts = args[++i];
    } else if (arg === '--prompts-file' && args[i + 1]) {
      options.promptsFile = args[++i];
    } else if (arg === '--models' && args[i + 1]) {
      options.models = args[++i];
    } else if (arg === '--no-switch' || arg === '--skip-switch') {
      options.autoSwitch = false;
    } else if (arg === '--auto-switch') {
      options.autoSwitch = true;
    } else if (arg === '--interactive' || arg === '-i') {
      options.interactive = true;
    } else if (arg === '--non-interactive' || arg === '-y' || arg === '--yes') {
      options.nonInteractive = true;
      options.yes = true;
    } else if (arg === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (arg === '--results' && args[i + 1]) {
      options.resultsJson = args[++i];
    }
  }

  return options;
}

function printHelp() {
  console.log(`
4-Model Automated Benchmark Suite (2 Interchangeable Prompts per Model)
========================================================================

Usage:
  node scripts/benchmark-all-models.mjs [options]
  npm run test:benchmark-all -- [options]

Interactive Prompt Entry:
  By default in an interactive terminal, the benchmark launches an interactive
  setup wizard allowing you to enter/paste prompt questions or pick presets
  before the test starts.

Options for Interchangeable Prompts:
  --interactive, -i     Force interactive prompt wizard before running.
  --non-interactive, -y Skip interactive wizard and run immediately with defaults or flags.

  --prompt1 <text>      Pass custom user prompt text for Prompt 1 directly.
  --prompt2 <text>      Pass custom user prompt text for Prompt 2 directly.

  --preset <name>       Choose a curated 2-prompt preset:
                        - codegen (default: Python file watcher + Docker compose)
                        - debugging (NaN defensive math + concurrency limiter)
                        - refactoring (Monolith decompose + TypeScript types)
                        - testing (Vitest boundaries + fast-check money)
                        - security (Auth session audit + SQL injection)
                        - architecture (Small SaaS scale-up + ESM migration)
                        - concurrency (Concurrency limiter + senior review)

  --prompts <ids>       Select any 2 prompt IDs or numbers from the 20-prompt catalog.
                        Examples: --prompts p1,p2  or  --prompts 4,6  or  --prompts p2,p20

  --prompts-file <path> Load 2 prompts from a custom JSON file.
                        Default file: scripts/benchmark-prompts.json

Model Selection & Spark Switching:
  --models <list>       Comma-separated list of models to test:
                        cloud, featherless, spark-gpt, spark-qwen, all (default: all)

  --no-switch           Do not switch Spark containers; only benchmark the currently
                        active Spark model along with cloud models.

  --auto-switch         (Default: true) Automatically switch between Spark Qwen and
                        Spark GPT-OSS 120B containers via SSH to test both.

  --output <path>       Custom destination file for evaluation markdown report.
  --results <path>      Custom destination file for raw JSON results.
  --help, -h            Show this help screen.

Examples:
  # 1. Interactive mode (enter questions before each run):
  node scripts/benchmark-all-models.mjs

  # 2. Enter questions via flags (non-interactive):
  node scripts/benchmark-all-models.mjs --prompt1 "Explain Paxos vs Raft" --prompt2 "Write an LRU cache in Go"

  # 3. Use debugging preset questions:
  node scripts/benchmark-all-models.mjs --preset debugging -y

  # 4. Fast benchmark of cloud models + current local model without container switch:
  node scripts/benchmark-all-models.mjs --no-switch
`);
}

// Resolve initial candidate prompts from CLI or defaults
function resolveCandidatePrompts(options) {
  // Case 1: Custom prompt text passed directly
  if (options.prompt1 || options.prompt2) {
    const p1Text = options.prompt1 || PROMPT_CATALOG[0].userPrompt;
    const p2Text = options.prompt2 || PROMPT_CATALOG[1].userPrompt;
    return [
      {
        num: 1,
        id: 'custom_1',
        category: 'Custom Question',
        title: 'Custom Prompt 1',
        constraints: ['Direct user-provided prompt'],
        userPrompt: p1Text,
      },
      {
        num: 2,
        id: 'custom_2',
        category: 'Custom Question',
        title: 'Custom Prompt 2',
        constraints: ['Direct user-provided prompt'],
        userPrompt: p2Text,
      },
    ];
  }

  // Case 2: Custom prompts file specified or default file exists
  const jsonPath = options.promptsFile || path.join(root, 'scripts', 'benchmark-prompts.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      if (Array.isArray(raw) && raw.length >= 2) {
        return [
          { num: 1, ...raw[0] },
          { num: 2, ...raw[1] },
        ];
      }
    } catch (e) {
      // ignore, fall back
    }
  }

  // Case 3: Pick by ID or number e.g. "p1,p6" or "1,6"
  if (options.prompts) {
    const parts = options.prompts.split(',').map(s => s.trim().toLowerCase());
    const matched = [];
    for (const part of parts) {
      const byId = PROMPT_CATALOG.find(p => p.id.toLowerCase().startsWith(part) || p.id.toLowerCase() === part);
      const byNum = PROMPT_CATALOG.find(p => String(p.num) === part.replace(/^p/, ''));
      const found = byId || byNum;
      if (found) matched.push(found);
    }
    if (matched.length >= 2) {
      return [
        { ...matched[0], num: 1 },
        { ...matched[1], num: 2 },
      ];
    }
  }

  // Case 4: Preset selected
  const presetKey = (options.preset || 'default').toLowerCase();
  const presetIds = PRESETS[presetKey] || PRESETS.default;
  const p1 = PROMPT_CATALOG.find(p => p.id === presetIds[0]) || PROMPT_CATALOG[0];
  const p2 = PROMPT_CATALOG.find(p => p.id === presetIds[1]) || PROMPT_CATALOG[1];

  return [
    { ...p1, num: 1 },
    { ...p2, num: 2 },
  ];
}

// Interactive Prompt Setup Wizard before each run
async function runInteractivePromptWizard(initialPrompts) {
  const rl = readline.createInterface({ input, output });

  try {
    console.log('\n================================================================');
    console.log(' BENCHMARK PROMPT SETUP: INTERCHANGEABLE PROMPTS BEFORE RUN     ');
    console.log('================================================================');
    console.log('How would you like to provide the 2 benchmark prompts for this run?');
    console.log('  [1] Enter custom prompt questions now (type or paste custom text)');
    console.log('  [2] Select a curated preset (codegen, debugging, security, etc.)');
    console.log('  [3] Select 2 prompts by number from the 20-prompt catalog (1 - 20)');
    console.log('  [4] Use current default prompts:');
    console.log(`      P1: ${initialPrompts[0].title}`);
    console.log(`      P2: ${initialPrompts[1].title}`);
    console.log('----------------------------------------------------------------');

    const choice = (await rl.question('Choose an option [1-4] (default: 1): ')).trim() || '1';

    if (choice === '1') {
      console.log('\n----------------------------------------------------------------');
      console.log('1. ENTER PROMPT 1:');
      console.log(`(Press Enter directly to keep default: "${initialPrompts[0].title}")`);
      const rawP1 = (await rl.question('Prompt 1 > ')).trim();

      console.log('\n----------------------------------------------------------------');
      console.log('2. ENTER PROMPT 2:');
      console.log(`(Press Enter directly to keep default: "${initialPrompts[1].title}")`);
      const rawP2 = (await rl.question('Prompt 2 > ')).trim();

      const p1 = rawP1 ? {
        num: 1,
        id: 'custom_1',
        category: 'Custom Question',
        title: rawP1.length > 55 ? rawP1.slice(0, 52) + '...' : rawP1,
        constraints: ['Direct user-provided prompt'],
        userPrompt: rawP1,
      } : initialPrompts[0];

      const p2 = rawP2 ? {
        num: 2,
        id: 'custom_2',
        category: 'Custom Question',
        title: rawP2.length > 55 ? rawP2.slice(0, 52) + '...' : rawP2,
        constraints: ['Direct user-provided prompt'],
        userPrompt: rawP2,
      } : initialPrompts[1];

      // Offer to save as new default
      const saveChoice = (await rl.question('\nSave these as default in scripts/benchmark-prompts.json? [y/N]: ')).trim().toLowerCase();
      if (saveChoice === 'y' || saveChoice === 'yes') {
        const savePath = path.join(root, 'scripts', 'benchmark-prompts.json');
        fs.writeFileSync(savePath, JSON.stringify([p1, p2], null, 2), 'utf8');
        console.log(`Saved new prompts to: ${savePath}`);
      }

      return [p1, p2];
    } else if (choice === '2') {
      console.log('\nAvailable Curated Presets:');
      console.log('  1. codegen      (Folder Watcher & Docker Compose Stack)');
      console.log('  2. debugging    (NaN Form Math Bug & Concurrency Limiter)');
      console.log('  3. refactoring  (Decompose Order Pipeline & Strict TypeScript Types)');
      console.log('  4. testing      (Vitest Boundary Tests & fast-check Property Tests)');
      console.log('  5. security     (Auth Flow Vulnerabilities & SQL Injection Audit)');
      console.log('  6. architecture (Simplest SaaS Scale-Up & ESM Migration Plan)');
      console.log('  7. concurrency  (Concurrency Limiter & Senior Code Review)');

      const presetChoice = (await rl.question('Select Preset [1-7] (default: 1): ')).trim() || '1';
      const presetMap = {
        '1': 'codegen', '2': 'debugging', '3': 'refactoring',
        '4': 'testing', '5': 'security', '6': 'architecture', '7': 'concurrency'
      };
      const presetName = presetMap[presetChoice] || 'codegen';
      const ids = PRESETS[presetName] || PRESETS.default;
      const p1 = PROMPT_CATALOG.find(p => p.id === ids[0]) || PROMPT_CATALOG[0];
      const p2 = PROMPT_CATALOG.find(p => p.id === ids[1]) || PROMPT_CATALOG[1];
      return [{ ...p1, num: 1 }, { ...p2, num: 2 }];
    } else if (choice === '3') {
      console.log('\n20-Prompt Technical Evaluation Catalog:');
      for (const p of PROMPT_CATALOG) {
        console.log(`  [${String(p.num).padStart(2, ' ')}] ${p.title} (${p.category})`);
      }
      const pair = (await rl.question('\nEnter 2 prompt numbers separated by comma (e.g. 1, 6 or 4, 14): ')).trim() || '1, 2';
      const parts = pair.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      const p1Num = parts[0] || 1;
      const p2Num = parts[1] || 2;
      const p1 = PROMPT_CATALOG.find(p => p.num === p1Num) || PROMPT_CATALOG[0];
      const p2 = PROMPT_CATALOG.find(p => p.num === p2Num) || PROMPT_CATALOG[1];
      return [{ ...p1, num: 1 }, { ...p2, num: 2 }];
    } else {
      return initialPrompts;
    }
  } finally {
    rl.close();
  }
}

// Spark Container Management Helpers
async function getActiveSparkModel(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/models`, { method: 'GET' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.[0]?.id || null;
  } catch (e) {
    return null;
  }
}

async function waitForSparkReady(expectedModel, timeoutSec = 240) {
  process.stdout.write(`Waiting for Spark container to load ${expectedModel}...`);
  const start = Date.now();
  while (Date.now() - start < timeoutSec * 1000) {
    try {
      const res = await fetch('http://127.0.0.1:8000/v1/models');
      if (res.ok) {
        const data = await res.json();
        const active = data.data?.[0]?.id;
        if (active && (active.includes(expectedModel) || expectedModel.includes(active))) {
          console.log(` Ready! (${((Date.now() - start) / 1000).toFixed(1)}s)`);
          return true;
        }
      }
    } catch (e) {
      // transient connection error while restarting
    }
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 6000));
  }
  console.log(` Timed out waiting for ${expectedModel}.`);
  return false;
}

function switchSparkContainer(targetComposeFile) {
  console.log(`\n[Spark Switch] Launching ${targetComposeFile} via SSH on flak3dd...`);
  try {
    const cmd = `ssh flak3dd 'docker rm -f qwen-abliterated gpt-oss-120b-abliterated || true && cd ~/spark && docker compose -f ${targetComposeFile} up -d --force-recreate'`;
    execSync(cmd, { stdio: 'inherit' });
    return true;
  } catch (e) {
    console.error(`[Spark Switch Error] Failed to switch container: ${e.message}`);
    return false;
  }
}

// Run single prompt against a model
async function runModelPrompt(modelConfig, promptItem) {
  console.log(`\n----------------------------------------------------------------`);
  console.log(`[${modelConfig.shortName}] Prompt ${promptItem.num}: ${promptItem.title}`);
  console.log(`----------------------------------------------------------------`);
  console.log(`Query: "${promptItem.userPrompt.slice(0, 90).replace(/\n/g, ' ')}..."`);

  const headers = { 'Content-Type': 'application/json' };
  if (modelConfig.apiKey) {
    headers['Authorization'] = `Bearer ${modelConfig.apiKey}`;
  }

  const systemMessage = `You are an expert software engineer and systems architect. Provide direct, thorough, fully implemented solutions with zero placeholder code or stubs. Strictly follow all user constraints and formatting instructions.`;

  const requestBody = {
    model: modelConfig.model,
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: promptItem.userPrompt },
    ],
    temperature: modelConfig.temperature,
    max_tokens: 4096,
    stream: true,
  };

  if (modelConfig.repetitionPenalty && modelConfig.repetitionPenalty > 1.0) {
    requestBody.repetition_penalty = modelConfig.repetitionPenalty;
  }

  const startTime = Date.now();
  let firstTokenTime = null;
  let fullContent = '';
  let fullReasoning = '';

  try {
    const res = await fetch(`${modelConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${errBody}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          const choice = json.choices?.[0];
          if (!choice) continue;

          // Reasoning tokens
          const rChunk =
            choice.delta?.reasoning ||
            choice.delta?.reasoning_content ||
            choice.delta?.thinking ||
            '';
          if (rChunk) {
            fullReasoning += rChunk;
            if (!firstTokenTime) firstTokenTime = Date.now();
          }

          // Content tokens
          const cChunk = choice.delta?.content || '';
          if (cChunk) {
            fullContent += cChunk;
            if (!firstTokenTime) firstTokenTime = Date.now();
          }
        } catch (e) {
          // fragmented chunk
        }
      }
    }

    // Post-process channel tags if streamed inline
    if (!fullReasoning && fullContent.includes('<|channel|>analysis')) {
      const finalIdx = fullContent.indexOf('<|channel|>final');
      if (finalIdx !== -1) {
        fullReasoning = fullContent.slice(0, finalIdx)
          .replace(/<\|start\|>assistant|<\|channel\|>analysis(?:<\|message\|>)?/g, '')
          .trim();
        fullContent = fullContent.slice(finalIdx)
          .replace(/<\|channel\|>final(?:<\|message\|>)?/g, '')
          .replace(/<\|end\|>|<\|return\|>|<\|start\|>assistant/g, '')
          .trim();
      }
    } else if (!fullReasoning && fullContent.includes('<thought>')) {
      const m = fullContent.match(/<thought>([\s\S]*?)<\/thought>/);
      if (m) {
        fullReasoning = m[1].trim();
        fullContent = fullContent.replace(/<thought>[\s\S]*?<\/thought>/, '').trim();
      }
    }

    // Clean control tokens
    fullContent = fullContent.replace(/<\|end\|>|<\|return\|>|<\|start\|>assistant/g, '').trim();

    if (!fullContent && fullReasoning) {
      fullContent = fullReasoning;
      fullReasoning = '';
    }

    const elapsedMs = Date.now() - startTime;
    const ttftMs = firstTokenTime ? firstTokenTime - startTime : elapsedMs;
    const contentTokens = Math.round(fullContent.length / 3.8);
    const reasoningTokens = Math.round(fullReasoning.length / 3.8);
    const totalTokens = contentTokens + reasoningTokens;
    const tokPerSec = totalTokens > 0 && elapsedMs > 0 ? (totalTokens / (elapsedMs / 1000)).toFixed(1) : '0';

    console.log(`Status       : SUCCESS (PASS)`);
    console.log(`TTFT         : ${ttftMs} ms | Elapsed: ${(elapsedMs / 1000).toFixed(2)} s`);
    console.log(`Tokens       : ~${contentTokens} content + ~${reasoningTokens} reasoning = ~${totalTokens} total (${tokPerSec} t/s)`);

    return {
      success: true,
      promptNum: promptItem.num,
      promptId: promptItem.id,
      promptTitle: promptItem.title,
      promptCategory: promptItem.category,
      promptText: promptItem.userPrompt,
      content: fullContent,
      reasoning: fullReasoning,
      stats: {
        elapsedMs,
        ttftMs,
        contentTokens,
        reasoningTokens,
        totalTokens,
        tokPerSec: Number(tokPerSec),
      },
    };
  } catch (err) {
    console.error(`Status       : FAILED — ${err.message}`);
    return {
      success: false,
      promptNum: promptItem.num,
      promptId: promptItem.id,
      promptTitle: promptItem.title,
      promptCategory: promptItem.category,
      promptText: promptItem.userPrompt,
      error: err.message,
    };
  }
}

// Generate Markdown Evaluation Report
function generateMarkdownReport(benchmarkResults, activePrompts) {
  let md = `# 4-Model Comparative Benchmark Review: 2 Interchangeable Prompts\n\n`;
  md += `**Execution Date:** ${new Date().toISOString()}  \n`;
  md += `**Test Suite:** 2 Standardized Prompts Evaluated Across 4 Abliterated Models  \n\n`;

  md += `## 1. Selected Interchangeable Prompts\n\n`;
  for (const p of activePrompts) {
    md += `### Prompt ${p.num}: ${p.title} (${p.category})\n`;
    md += `> ${p.userPrompt.replace(/\n/g, '\n> ')}\n\n`;
  }

  md += `## 2. Cross-Model Performance Matrix\n\n`;
  md += `| Model | Environment | Prompt | TTFT | Elapsed | Content Tok | Reasoning Tok | Speed | Status |\n`;
  md += `|---|---|---|---|---|---|---|---|---|\n`;

  for (const mRes of benchmarkResults) {
    for (const r of mRes.promptRuns) {
      if (!r.success) {
        md += `| ${mRes.shortName} | ${mRes.env} | #${r.promptNum} ${r.promptTitle.slice(0, 20)}... | ERR | ERR | - | - | - | FAILED |\n`;
      } else {
        md += `| **${mRes.shortName}** | ${mRes.env} | #${r.promptNum} ${r.promptTitle.slice(0, 25)} | ${r.stats.ttftMs}ms | ${(r.stats.elapsedMs / 1000).toFixed(1)}s | ~${r.stats.contentTokens} | ~${r.stats.reasoningTokens} | **${r.stats.tokPerSec} t/s** | PASS |\n`;
      }
    }
  }

  md += `\n## 3. Side-by-Side Response Excerpts & Comparison\n\n`;

  for (const p of activePrompts) {
    md += `### Evaluation on Prompt ${p.num}: "${p.title}"\n\n`;

    for (const mRes of benchmarkResults) {
      const run = mRes.promptRuns.find(pr => pr.promptNum === p.num);
      md += `#### ${mRes.name} (${mRes.env})\n\n`;

      if (!run || !run.success) {
        md += `*Execution Error:* ${run?.error || 'Did not complete'}\n\n`;
        continue;
      }

      md += `- **TTFT:** ${run.stats.ttftMs} ms | **Elapsed:** ${(run.stats.elapsedMs / 1000).toFixed(2)} s\n`;
      md += `- **Tokens:** ~${run.stats.contentTokens} content + ~${run.stats.reasoningTokens} reasoning (${run.stats.tokPerSec} tok/s)\n\n`;

      if (run.reasoning) {
        md += `<details><summary><b>Reasoning Trace (~${run.stats.reasoningTokens} tokens)</b></summary>\n\n`;
        md += `\`\`\`text\n${run.reasoning.slice(0, 1500)}${run.reasoning.length > 1500 ? '\n...[truncated display]...' : ''}\n\`\`\`\n\n</details>\n\n`;
      }

      md += `\`\`\`\n${run.content.slice(0, 1200)}${run.content.length > 1200 ? '\n...[continued in raw results]...' : ''}\n\`\`\`\n\n`;
    }

    md += `---\n\n`;
  }

  md += `## 4. Evaluation Dimensions & Key Insights\n\n`;
  md += `1. **Dimension (a) — Mundane Task Reasoning Quality:** How well does the model retain programming logic, typing, and syntax without safety-refusal interference?\n`;
  md += `2. **Dimension (b) — Confident Incorrectness vs Sound Hedging:** Does the model identify subtle concurrency bugs, resource locks, and environment traps?\n`;
  md += `3. **Dimension (c) — Strict Constraint Compliance:** Does the model observe negative constraints (zero external UI dependencies, strict rate limits, exact types)?\n`;

  return md;
}

// Main Orchestrator
async function main() {
  const options = parseCliArgs();

  if (options.help) {
    printHelp();
    return;
  }

  console.log('================================================================');
  console.log(' 4-MODEL BENCHMARK SUITE — 2 INTERCHANGEABLE PROMPTS PER MODEL  ');
  console.log('================================================================');

  // Candidate prompts from defaults or flags
  let candidatePrompts = resolveCandidatePrompts(options);

  // Check if we should prompt the user interactively
  const wantsInteractive = options.interactive === true || 
    (options.interactive === null && process.stdin.isTTY && !options.nonInteractive && !options.yes && !options.prompt1 && !options.prompt2);

  let activePrompts = candidatePrompts;
  if (wantsInteractive) {
    activePrompts = await runInteractivePromptWizard(candidatePrompts);
  }

  console.log('\n================================================================');
  console.log(' ACTIVE BENCHMARK PROMPTS FOR THIS RUN                          ');
  console.log('================================================================');
  console.log(`Prompt 1: [#${activePrompts[0].num}] ${activePrompts[0].title} (${activePrompts[0].category})`);
  console.log(`Prompt 2: [#${activePrompts[1].num}] ${activePrompts[1].title} (${activePrompts[1].category})`);

  const allModelConfigs = getModelConfigs();
  let targetModels = allModelConfigs;

  if (options.models && options.models !== 'all') {
    const selectedIds = options.models.split(',').map(s => s.trim().toLowerCase());
    targetModels = allModelConfigs.filter(m => selectedIds.includes(m.id) || selectedIds.includes(m.shortName.toLowerCase()));
  }

  console.log(`Target Models: ${targetModels.map(m => m.shortName).join(', ')}`);
  console.log('----------------------------------------------------------------\n');

  // Detect active Spark model
  const sparkBase = targetModels.find(m => m.isSpark)?.baseUrl || 'http://127.0.0.1:8000/v1';
  let activeSparkModel = await getActiveSparkModel(sparkBase);
  console.log(`Currently active Spark container model: ${activeSparkModel || 'None / Offline'}\n`);

  const benchmarkResults = [];

  // Group models: Run non-Spark models first, then manage Spark models
  const cloudModels = targetModels.filter(m => !m.isSpark);
  const sparkModels = targetModels.filter(m => m.isSpark);

  // 1. Run Cloud Models
  for (const modelConfig of cloudModels) {
    console.log(`\n================================================================`);
    console.log(`BENCHMARKING MODEL: ${modelConfig.name}`);
    console.log(`Endpoint: ${modelConfig.baseUrl} | Model: ${modelConfig.model}`);
    console.log(`================================================================`);

    const promptRuns = [];
    for (const p of activePrompts) {
      const runRes = await runModelPrompt(modelConfig, p);
      promptRuns.push(runRes);
    }

    benchmarkResults.push({
      ...modelConfig,
      promptRuns,
    });
  }

  // 2. Run Spark Models
  if (sparkModels.length > 0) {
    // Sort spark models so the currently active one runs first
    const sortedSparkModels = [...sparkModels].sort((a, b) => {
      const aActive = activeSparkModel && activeSparkModel.includes(a.model);
      const bActive = activeSparkModel && activeSparkModel.includes(b.model);
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      return 0;
    });

    for (let i = 0; i < sortedSparkModels.length; i++) {
      const modelConfig = sortedSparkModels[i];
      console.log(`\n================================================================`);
      console.log(`BENCHMARKING LOCAL SPARK MODEL: ${modelConfig.name}`);
      console.log(`Endpoint: ${modelConfig.baseUrl} | Model: ${modelConfig.model}`);
      console.log(`================================================================`);

      // Check if this model is active
      activeSparkModel = await getActiveSparkModel(sparkBase);
      const isAlreadyActive = activeSparkModel && (activeSparkModel.includes(modelConfig.model) || modelConfig.model.includes(activeSparkModel));

      if (!isAlreadyActive) {
        if (!options.autoSwitch) {
          console.log(`Skipping ${modelConfig.name}: Container is not currently active and --no-switch was passed.`);
          benchmarkResults.push({
            ...modelConfig,
            promptRuns: activePrompts.map(p => ({
              success: false,
              promptNum: p.num,
              promptId: p.id,
              promptTitle: p.title,
              promptCategory: p.category,
              promptText: p.userPrompt,
              error: 'Skipped: Inactive Spark container and --no-switch enabled',
            })),
          });
          continue;
        }

        // Auto-switch container
        const switched = switchSparkContainer(modelConfig.composeFile);
        if (!switched) {
          console.error(`Could not switch to ${modelConfig.composeFile}.`);
          continue;
        }

        const ready = await waitForSparkReady(modelConfig.model);
        if (!ready) {
          console.error(`Spark container for ${modelConfig.model} did not become ready in time.`);
          continue;
        }
      }

      // Run the 2 prompts on this Spark model
      const promptRuns = [];
      for (const p of activePrompts) {
        const runRes = await runModelPrompt(modelConfig, p);
        promptRuns.push(runRes);
      }

      benchmarkResults.push({
        ...modelConfig,
        promptRuns,
      });
    }
  }

  // Save Raw Results JSON
  fs.writeFileSync(options.resultsJson, JSON.stringify({
    timestamp: new Date().toISOString(),
    prompts: activePrompts,
    results: benchmarkResults,
  }, null, 2), 'utf8');

  // Generate and Save Markdown Report
  const report = generateMarkdownReport(benchmarkResults, activePrompts);
  fs.writeFileSync(options.output, report, 'utf8');

  console.log('\n================================================================');
  console.log(' BENCHMARK COMPLETE — SCORECARD SUMMARY                         ');
  console.log('================================================================');
  console.log(`Raw Results saved to : ${options.resultsJson}`);
  console.log(`Detailed Review saved to: ${options.output}\n`);

  // Console Table Summary
  console.log('MODEL               | PROMPT 1 TTFT/SPEED | PROMPT 2 TTFT/SPEED | STATUS');
  console.log('--------------------+---------------------+---------------------+-------');
  for (const m of benchmarkResults) {
    const r1 = m.promptRuns[0];
    const r2 = m.promptRuns[1];
    const s1 = r1?.success ? `${r1.stats.ttftMs}ms / ${r1.stats.tokPerSec}t/s` : 'FAILED';
    const s2 = r2?.success ? `${r2.stats.ttftMs}ms / ${r2.stats.tokPerSec}t/s` : 'FAILED';
    const ok = (r1?.success && r2?.success) ? 'PASS' : 'WARN';
    console.log(`${m.shortName.padEnd(19)} | ${s1.padEnd(19)} | ${s2.padEnd(19)} | ${ok}`);
  }
  console.log('================================================================\n');
}

main().catch(err => {
  console.error('Fatal error running benchmark suite:', err);
  process.exit(1);
});
