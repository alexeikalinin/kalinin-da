import type { RoleId } from "@ama/agent-framework";
import type { WorkflowEvent } from "@ama/events";

export type TaskOutcome = "success" | "needs_revision_then_success" | "failed" | "in_progress";

// Reflection §2 — walks the event history of one completed Project and
// summarizes what happened per Task: how many times it was sent back for
// revision, and how it eventually resolved.
export interface TaskAnalysis {
  readonly taskId: string;
  readonly roleId: RoleId;
  readonly revisionCount: number;
  readonly outcome: TaskOutcome;
}

export function analyzeProjectEvents(events: readonly WorkflowEvent[]): readonly TaskAnalysis[] {
  const byTask = new Map<
    string,
    { roleId: RoleId; revisionCount: number; outcome: TaskOutcome }
  >();

  for (const event of events) {
    if (!("taskId" in event)) continue;
    const entry = byTask.get(event.taskId) ?? {
      roleId: event.roleId,
      revisionCount: 0,
      outcome: "in_progress" as TaskOutcome,
    };

    if (event.type === "task_needs_revision") {
      entry.revisionCount += 1;
    } else if (event.type === "task_succeeded") {
      entry.outcome = entry.revisionCount > 0 ? "needs_revision_then_success" : "success";
    } else if (event.type === "task_failed") {
      entry.outcome = "failed";
    }

    byTask.set(event.taskId, entry);
  }

  return [...byTask.entries()].map(([taskId, entry]) => ({ taskId, ...entry }));
}
