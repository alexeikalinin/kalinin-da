# @ama/learning

Implements: docs/03-architecture/learning-system.md

- `lesson.ts` — the `Lesson` structure (§1) and `deriveConfidence`: an observation becomes a "pattern" once `groupKey`+role repeats enough times. The threshold (3, matching the doc's own VK Ads/B2B example) is an explicit calibration placeholder, same status as other deferred thresholds in this codebase.
- `record.ts` — `recordObservation`: Reflection records a new lesson; confidence is derived automatically, never asserted by the caller.
- `query.ts` — `findRelevantLessons`: what a role actually gets before a new Task (§2) — scoped to its own role, patterns surfaced first.
- `generalize.ts` — `proposeGeneralizedLesson`/`confirmGeneralizedLesson` (§4): a pattern confirmed across multiple tenants may be promoted to the shared Domain KB, reusing `@ama/knowledge-base`'s `resolveProposal` so the same conflict check applies ("по той же логике").
- `priority.ts` — `pickGuidance` (§5): a confirmed Knowledge Base fact always wins over a Learning Memory conclusion at the same key.

Depends on `@ama/memory` (storage, isolation, propose/confirm) and `@ama/knowledge-base` (shared confirm/conflict logic for the generalization path). Not yet implemented: real similarity detection between situations (grouping is caller-supplied via `groupKey`, not inferred) and the actual threshold calibration (Open Questions #1–2).
