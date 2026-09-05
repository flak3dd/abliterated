| ID | Area | Status | Severity | Notes |
|---|---|---|---|---|
| B-01 | Buffers | PASS |  | set_root /Users/adminuser/abliterated/.ide-qa-fixtures/hello-ts |
| E-02 | Explorer | PASS |  | ls sees fixture: {"runId":"run_mtntfhc9_2bz950","status":"ok","entries":[{"name":"index.ts","path":"index.ts","dir":false},{"name":"package.json","path":"package.json","dir":false}]} |
| B-02 | Buffers | PASS |  | write_file .ide-qa-probe-1788578451081.txt |
| B-03 | Buffers | PASS |  | read_file matches |
| B-04 | Buffers | PASS |  | delete_file .ide-qa-probe-1788578451081.txt |
| B-04b | Buffers | PASS |  | file gone from disk |
| M-02 | SCM | PASS |  | git_status: {"runId":"run_mtntfhcb_4ap80s","status":"ok","branch":"","dirty":false,"porcelain":"","text":"not a git repository","content":"not a git repository"} |
| U-02 | MCP | PASS |  | mcp_connect tools=echo,add |
| U-03 | MCP | PASS |  | mcp_call_tool: bridge-mcp |
| U-04 | MCP | PASS |  | mcp_disconnect |
