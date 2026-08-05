# @ama/events

Implements: docs/03-architecture/events.md and docs/03-architecture/logging-audit.md

Logging/Audit has no dedicated package — its own §2 says outright it "is not a separate, independently working mechanism," it's the discipline of subscribing to every event. That discipline lives here, next to the bus it depends on (same reasoning as Queue living inside `@ama/workflow-engine` — see Repository Structure §2a).

- `events.ts` — the 11 event types from Events §1 (`WorkflowEvent` union), each carrying `tenantId`/`projectId`/`at`. `TaskSucceeded` also carries `decisions` (added for Logging/Audit §1 — "Принятые решения" is a required journal field, and Agent Framework's `AgentOutput` already produces it; the parameter is optional on the constructor for backward compatibility).
- `create.ts` — one constructor per event type, centralizing the timestamp stamp.
- `bus.ts` — a minimal in-memory pub/sub bus (placeholder for the real one — technology choice is explicitly out of scope for Events).
- `subscriptions.ts` — Events §2 ("кто на что подписан") as named constants plus `subscribeToAll`/`subscribeToTypes`.
- `journal.ts` — **Logging/Audit's actual content**: `attachLogSink` subscribes to `"*"` unconditionally (§2/§3 — no filtering by event type or Execution Tier, satisfying NFR-7 structurally: there is no code path for an event to occur and not reach the sink); `reconstructJournal` rebuilds the §1 required fields per Task (start/end time, decisions, errors, warnings, result) from the raw event stream, reproducing the §5 reference example directly in its tests.

Not yet implemented: durable storage of log entries (the `event` table already exists in `supabase/migrations/0001_init.sql` — wiring `attachLogSink` to actually write there is Deployment work, not an architectural decision), a production-grade bus.
