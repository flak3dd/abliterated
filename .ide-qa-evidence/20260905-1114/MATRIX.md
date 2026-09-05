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
