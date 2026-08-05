import type { EventBus, EventHandler, Unsubscribe } from "./bus.ts";
import type { WorkflowEvent, WorkflowEventType } from "./events.ts";

// Events §2 — "кто на что подписан", encoded as named constants rather than
// left implicit at each call site, so the rule is checkable in one place
// instead of re-derived by whoever wires up Logging/Audit, progress, etc.

// FR-3: progress view is built from these — not required to be delivered
// instantly (NFR-8, periodic pull is enough).
export const PROGRESS_EVENT_TYPES: readonly WorkflowEventType[] = [
  "task_queued",
  "task_started",
  "task_succeeded",
  "task_failed",
];

// FR-4/NFR-9: completion notification. See NFR-9's Decision Log for the
// temporary weakening (no proactive delivery until the Telegram bot exists) —
// that weakening lives in the API/Application Layer, not here: this constant
// still names the *target* subscription per the target requirement.
export const NOTIFICATION_EVENT_TYPES: readonly WorkflowEventType[] = [
  "project_completed",
];

// Recovery §3/§4 decides what to do next on these.
export const RECOVERY_EVENT_TYPES: readonly WorkflowEventType[] = [
  "task_stuck",
  "task_failed",
];

export function subscribeToAll(
  bus: EventBus,
  handler: EventHandler<WorkflowEvent>,
): Unsubscribe {
  return bus.subscribe("*", handler);
}

export function subscribeToTypes(
  bus: EventBus,
  types: readonly WorkflowEventType[],
  handler: EventHandler<WorkflowEvent>,
): Unsubscribe {
  const unsubscribers = types.map((type) => bus.subscribe(type, handler));
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}
