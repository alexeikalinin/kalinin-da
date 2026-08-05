# @ama/agent-agent-architect

Implements: docs/03-architecture/agent-framework.md §4a (meta-role: Agent Architect)

A service role, like Reflection — not part of the marketing reference conveyor. Proposes a new role's spec (same 11-element contract every role uses) given a free-text description and the list of already-registered role ids, so the model can flag overlapping responsibility (Agent Framework §1).

**Declares zero memory levels and zero tools, and never calls `memory.write`** — verified directly in `agent-architect.test.ts`. This isn't an oversight: §4a is explicit that Agent Architect only *proposes*, it never registers or activates a role itself. There is nowhere in this codebase a proposal from here gets written to without an approver acting on it — that step (turning a `ProposedRoleSpec` into an actual registered `@ama/agent-framework` role, and a published `@ama/prompt-architecture` template) is Stage 2 product work, not built yet.
