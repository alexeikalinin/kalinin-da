# @ama/agent-pm

Implements: docs/03-architecture/agent-framework.md and docs/03-architecture/workflow-engine.md §1 (role: PM Agent)

Not in Repository Structure's original `packages/agents/` list — added 2026-08-12 (see Repository Structure §2d). **This is the real implementation of graph-building** — every graph used before this (including `@ama/reference-scenario`'s) was hand-written directly in a test. `createPmAgent`'s handler asks the model to select roles + dependencies, then validates the result through `@ama/workflow-engine`'s real `buildGraph` (same cycle/dangling-dependency checks Workflow Engine itself relies on) before returning it — an invalid proposal is PM's own mistake and comes back as a retryable failure, not a silent bad graph.

`pm-agent.test.ts` reproduces Workflow Engine §1's own worked example (the ad-campaign task, correctly excluding SEO) and proves the resulting graph is genuinely usable: `getReadyNodes` on PM's own output shows PPC and Media Buyer becoming ready together, exactly like the hand-written version did.
