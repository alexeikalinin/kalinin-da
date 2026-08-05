import type { RoleId } from "@ama/agent-framework";
import type { Actor, MemoryStore } from "@ama/memory";
import type { Lesson } from "./lesson.ts";

export function listLessons(store: MemoryStore, actor: Actor): readonly Lesson[] {
  return store.listRecords(actor, "learning").map((record) => record.value as Lesson);
}

// Learning System §2 — what a role actually gets before starting a new
// Task: lessons scoped to its own role. Patterns are surfaced first, since
// they're the ones confident enough to actually change behavior (§3).
export function findRelevantLessons(
  store: MemoryStore,
  actor: Actor,
  roleId: RoleId,
): readonly Lesson[] {
  return listLessons(store, actor)
    .filter((lesson) => lesson.roleId === roleId)
    .sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === "pattern" ? -1 : 1));
}
