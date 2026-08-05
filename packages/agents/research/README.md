# @ama/agent-research

Implements: docs/03-architecture/agent-framework.md (role: Research Agent)

The root of the reference graph (Workflow Engine §1) — no dependencies, calls two tools (`site-reader`, `web-search`, Tool Integration §1) before the model, fails fast without calling the model if either tool fails. Writes its findings to Task Memory, ready for `archiveTaskIntoProject` to make them visible to PPC/Media Buyer/Analytics downstream — `integration.test.ts` runs this all the way through.

**Reminder, not a fix:** this is the role Security §7/Risk Register RISK-03b is actually about — reading an existing client site can surface a real person's name or contact. The user's own decision (2026-08-04) was not to add a technical restriction yet; nothing in this package enforces one. Revisit if/when RISK-03b is reassessed.
