import type { TenantId } from "@ama/agent-framework";
import type { Actor, MemoryStore } from "@ama/memory";
import { deriveConfidence, type Lesson } from "./lesson.ts";
import { listLessons } from "./query.ts";

// Learning System §1/§3 — Reflection records a new observation; confidence
// is derived automatically from how many prior lessons share the same
// groupKey + role, not asserted by the caller.
export function recordObservation(
  store: MemoryStore,
  reflectionActor: Actor, // must be actor.kind === "reflection"
  tenantId: TenantId,
  key: string,
  lesson: Omit<Lesson, "confidence">,
): Lesson {
  const priorCount = listLessons(store, reflectionActor).filter(
    (existing) => existing.groupKey === lesson.groupKey && existing.roleId === lesson.roleId,
  ).length;

  const full: Lesson = { ...lesson, confidence: deriveConfidence(priorCount + 1) };
  store.recordLesson(reflectionActor, { level: "learning", tenantId, key }, full);
  return full;
}
