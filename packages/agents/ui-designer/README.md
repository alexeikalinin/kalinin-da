# @ama/agent-ui-designer

Implements: docs/03-architecture/agent-framework.md (role: UI Designer Agent)

Depends on UX Agent's plan, written directly to Project Memory (same convention as Media Buyer — see `@ama/agent-ux`'s README). Calls a design tool before the model, same fail-fast pattern as every other tool-using role in this codebase.

`integration.test.ts` chains a real UX run into a real UI Designer run. Note: `projectContextKeys: ["ux-plan"]` is passed through to `assemblePrompt`, but — same caveat as `@ama/agent-analytics` — the plan is a structured object, not a string, so it won't actually surface as prompt text; the model caller in the test stands in for what a real UI Designer would have actually read.
