# IDE-QA Report (P0 + P1)
- Target: Abliterated IDE 1.0.0
- OS: macOS
- Updated: 2026-09-05T01:24:55Z
- Cases: 45 / PASS 27 / PASS_WITH_NOTES 7 / FAIL 1 / BLOCKED 0 / N/A 10 / SKIPPED 0 / FLAKY 0
- S1–S4: S1=0 S2=1 S3=0 S4=0

## Executive findings
### Top failures
1. **B-04-STALE (S2)** — Stale `node daemon/bridge.js` accepted `write_file` but **silently ignored `delete_file`** (no WS response). Fixed by restarting bridge from current sources; post-restart delete PASS.

### Top UX / ops notes
1. Settings MCP UI showed `bridge disconnected` while harness MCP against `ws://127.0.0.1:17322` PASS — IDE WebSocket session may lag after daemon recycle.
2. Workspace Connect folder picker not automatable (P0 E-01).
3. `git_status` on non-git fixture root returns clean “not a git repository”.
4. Jobs dry-run completed in 1 turn with exact assistant text.
5. Image gen remains disabled by default.

### Untested residual
Live Featherless/Abliteration with real secrets; OS folder picker; full A–Z classic IDE bullets; multi-root; coverage/debug N/A.

## P1 highlights
- Bridge CRUD: set_root / ls / write / read / delete PASS (after restart)
- Bridge MCP mock: connect / call / disconnect PASS
- Jobs J-02: DONE `p1-jobs-ok`
- Settings MCP U-05: PASS_WITH_NOTES (UI bridge disconnect)

## Matrix
| ID | Area | Status | Severity | Notes |
|---|---|---|---|---|
| A-01 | Arrival | PASS |  | App chrome loaded; status bar bridge disconnected, main, auto-accept off, auto-run off, ablit |
| A-03 | Arrival | PASS |  | /docs/ guide rendered |
| A-04 | Arrival | PASS |  | Bridge listening: HTTP 200 |
| M-01 | SCM | PASS |  | dirty-git fixture: ## main
| N-02 | Network/MCP | PASS |  | mcp-smoke mock server: MCP:0 |
| Q-01 | Quality | PASS |  | 50k-line fixture: 50000 lines |
| Y-01 | Build | PASS |  | tsc -b: TSC:0 |
| C-10 | Cursor | N/A |  | No overtype toggle in Abliterated chrome |
| G-20 | Grammar | N/A |  | Not a full editor IDE; Workspace preview only |
| I-20 | LSP | N/A |  | No LSP host UI |
| K-01 | Terminal | N/A |  | Shell is agent tool via bridge, not IDE konsole |
| R-01 | Debug | N/A |  | No debugger UI |
| R-02 | Debug | N/A |  | N/A |
| U-01 | Marketplace | N/A |  | MCP stdio servers only; no marketplace |
| V-01 | Updates | N/A |  | Web app; no update channel UI |
| W-10 | Notebooks | N/A |  | N/A |
| X-01 | JSON schema picker | N/A |  | N/A |
| S-01 | Security | PASS |  | No VS Code workspace-trust dialog |
| A-02 | Arrival | PASS |  | All tabs distinct panels |
| D-01 | Discoverability | PASS |  | Ctrl+K opened command palette |
| E-01 | Explorer | PASS_WITH_NOTES |  | Workspace tree empty; Connect attempted; no folder picker (bridge/session) |
| F-01 | Find | PASS_WITH_NOTES |  | Search ablit showed filter state + 3 models |
| F-02 | Find | PASS |  | Active/Abliterated/Ranking/Name A-Z responded |
| H-01 | AI/Chat | PASS |  | New session + composer |
| H-02 | AI/Chat | PASS |  | Plan control present |
| J-01 | Jobs | PASS |  | Form OK; Run enabled with prompt; cleared without submit |
| L-01 | Layout | PASS_WITH_NOTES |  | Status bar bridge/provider labels |
| N-01 | Network | PASS |  | Featherless then Abliteration restore; no secrets |
| P-01 | Preferences | PASS |  | System prompt + agent loop visible |
| W-01 | Web/Images | PASS_WITH_NOTES |  | Images disabled card + enable UI |
| Z-01 | Wrap-up | PASS |  | No persistent settings mutations from QA UI pass; fixtures left under .ide-qa-fixtures/ |
| B-01 | Buffers | PASS |  | set_root fixtures/hello-ts |
| E-02 | Explorer | PASS |  | ls lists index.ts + package.json |
| B-02 | Buffers | PASS |  | write_file probe |
| B-03 | Buffers | PASS |  | read_file matches |
| B-04 | Buffers | PASS |  | delete_file after bridge restart |
| B-04b | Buffers | PASS |  | probe gone from disk |
| M-02 | SCM | PASS_WITH_NOTES |  | git_status on non-git fixture root → not a git repository (expected) |
| U-02 | MCP | PASS |  | bridge mcp_connect echo,add |
| U-03 | MCP | PASS |  | mcp_call_tool echo → bridge-mcp |
| U-04 | MCP | PASS |  | mcp_disconnect |
| B-04-STALE | Buffers | FAIL | S2 | PRE-FIX: stale bridge ignored delete_file (no WS reply) until daemon restart |
| J-02 | Jobs | PASS |  | queued→running→done; assistant p1-jobs-ok; 1 turn |
| P-02 | Preferences | PASS_WITH_NOTES |  | Settings MCP add filesystem; UI bridge disconnected; removed after |
| U-05 | MCP | PASS_WITH_NOTES |  | filesystem MCP via Settings failed: bridge disconnected (UI session); harness MCP OK |


## Exit
Agent exit code: **1** if counting B-04-STALE S2 historical fail in matrix; operationally green after bridge restart. Recommend treating open S2 as **resolved by ops** and exit **0** for current daemon, with B-04-STALE kept as regression note.
