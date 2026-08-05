# @ama/prompt-architecture

Implements: docs/03-architecture/prompt-architecture.md

- `blocks.ts` — `PromptBlocks`, the 7 typed blocks from §1 (role, task, client facts, domain knowledge, past experience, project context, constraints).
- `template-registry.ts` — `RoleTemplateRegistry`: every proposed version of a role's "Роль" block is kept (never overwritten), and publishing a version as active always requires an approver (§3/§4).
- `assemble.ts` — `assemblePrompt`: pulls each block from its documented source (`@ama/memory` for client/domain/project data, `@ama/learning` for past lessons) and applies Execution Tier as a *depth* limit (§2) — Fast keeps fewer facts/lessons, Standard keeps more; the block structure itself never changes between tiers.

Deliberately not implemented, per Scope: concrete wording for any specific role's template (Agent Architect's job), and the LLM provider call format (§5 — a separate adapter, so this package stays provider-agnostic per ADR-0003).

Open Questions carried over, not resolved here: what happens when the assembled prompt is too large (deferred to Cost Optimization), and the physical storage format for template versions (deferred to Database).
