# @ama/workflow-engine

Implements: docs/03-architecture/workflow-engine.md and docs/03-architecture/queue.md

Queue has no dedicated package — per ADR-0002, its mechanics are mostly opaque inside Vercel Workflow DevKit. The policy that's actually ours to own (isolation, staleness detection) lives here, next to the graph/state machinery it depends on.

- `graph.ts` — builds and validates a Task graph (no cycles, no dangling dependencies).
- `state.ts` — tracks node state (including `running`) and computes which nodes are ready to dispatch (this is where NFR-5 parallelism actually happens: independent nodes become ready together); `requeueStuckTask` implements Queue §4.
- `strategy-gate.ts` — the plan pause/resume state machine (Workflow Engine §3).
- `recovery-policy.ts` — retry/escalate/block decision on task failure (Recovery §3). Retry limits are an explicit placeholder pending calibration (Backlog #12).
- `queue-policy.ts` — stuck-task detection by Execution Tier (Queue §4). Thresholds are an explicit placeholder pending calibration (Backlog #13).
- `dispatch.ts` — `createDispatchContext` binds a graph node to project-level facts (tenant, execution tier) into the immutable `InvocationContext` from `@ama/agent-framework` — this is the concrete implementation of Queue §5's isolation fix: a fresh, frozen context per dispatch, never shared or reused across invocations.

Not yet implemented: durable persistence of graph state (ADR-0002 — Vercel Workflow DevKit), event publication (`@ama/events`), and actually wiring `getReadyNodes` output to a live worker pool. This package currently models the *decisions* Workflow Engine/Queue make, not the infrastructure that carries them out.
