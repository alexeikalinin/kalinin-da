# @ama/tools

Implements: docs/03-architecture/tool-integration.md and docs/03-architecture/mcp-integration.md

- `registry.ts` — `ToolRegistry`: registering a new tool *type* requires an approver (Open Question #1, closed 2026-08-04) — the same "no autonomous critical change" pattern as role activation.
- `credentials.ts` — `CredentialStore`: a tenant's credential for a tool, issued by an approver. `get()` takes only an `Actor`, never a raw tenant id — there is structurally no code path that can request another tenant's key, not just a check that would reject it.
- `invoke.ts` — `invokeWithRetry`/`ToolUnavailableError`: the §4 distinction between "retry is enough" (throw `ToolUnavailableError`) and "critical, Task fails" (anything else) — exhausted retries produce a structured `AgentError` with `retryable` set correctly, ready for the handler to return as `AgentOutput`'s `"failed"` status.
- `agent-tool-port.ts` — `createAgentToolPort`: the `ToolPort` an agent actually sees, combining role-scoping (§2), registry approval, and a **fresh credential fetch on every single call** (MCP Integration §3 — no caching, so a rotated or wrong-tenant credential can never "stick" to a reused worker).

Not yet implemented: real MCP server adapters (the actual "translator" to Google Ads/VK Ads/etc. — Stage 2 integration work, not an architectural decision), credential storage/rotation mechanics (Security's job, Open Question #2).
