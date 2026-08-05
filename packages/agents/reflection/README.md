# @ama/agent-reflection

Implements: docs/03-architecture/reflection-system.md (service process, not a marketing role)

- `analyze.ts` — `analyzeProjectEvents`: mechanically walks a Project's event history and summarizes, per Task, how many revisions it took and how it resolved (success / needs-revision-then-success / failed).
- `reflect.ts` — `reflect`: turns noteworthy analyses into Learning Memory observations via `@ama/learning`'s `recordObservation`, then checks whether any of them reached `"pattern"` confidence — that check *is* the systemic-finding signal for Risk Register/Backlog (Reflection §4), not a second threshold invented on top of Learning System's own.

Scoping decisions, stated explicitly rather than left implicit:
- A clean first-try success is **not** recorded as its own lesson — only a failure, a revision-then-success, or a Task with several revisions is (Purpose: avoid "шум из случайных наблюдений").
- **Gap versus the doc's §3 claim:** Reflection is described as following Agent Framework's general contract (input/output/completion criteria). This implementation keeps `reflect()` as a plain function instead of wrapping it with `defineAgent`, because it needs direct `MemoryStore` access (`recordObservation`'s pattern lookup) that the standard `AgentInput`/`MemoryPort` abstraction doesn't expose. Noted here rather than papered over with a wrapper that wouldn't actually fit.
- "Эффективность промптов"/"эффективность инструментов" (§2) aren't analyzed yet — they need Prompt Architecture's version tracking and Tool Integration's per-call telemetry, neither of which exists as code yet.

`NOTEWORTHY_REVISION_COUNT` (currently 2, matching the doc's own Media Buyer example) is an explicit calibration placeholder, same status as the other deferred thresholds in this codebase.
