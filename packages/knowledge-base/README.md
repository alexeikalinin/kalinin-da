# @ama/knowledge-base

Implements: docs/03-architecture/knowledge-base.md

Builds on `@ama/memory`'s propose→confirm mechanism for the `domain_kb`/`client_kb` levels and adds the three rules that are specific to Knowledge Base:

- `direct.ts` — `recordFactDirectly`: a fact you state yourself is confirmed immediately (§2, source 1) — still runs through the same conflict check as everything else.
- `review.ts` — `reviewProposal`: given a significance classification (`"minor"` / `"significant"`) supplied by the caller, either auto-confirms via a `system` actor or leaves the proposal pending for a human approver (§2, sources 2–3). The classification rule itself is Knowledge Base Open Question #1 — deliberately not hardcoded here; PM Agent/Agent Architect supply the judgment call.
- `resolve.ts` — `resolveProposal`: the shared conflict check both of the above use (§3). "Conflict" is defined narrowly and honestly: an already-confirmed value at the same key that differs from the new proposal. It does not attempt semantic contradiction detection across different keys — that's out of scope.

Required a small, explicitly-justified extension to `@ama/memory`: an `Actor` kind `"system"` (auto-confirmation, distinct from a human `"approver"` for audit purposes) and `readRecord` (returns the full record, not just the value, so a conflict report can show *when* the existing fact was confirmed).

Not yet implemented: the significance classifier itself (Open Question #1), initial Domain KB population (Open Question #2).
