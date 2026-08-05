import type { AgentDecision, AgentError, RoleId } from "@ama/agent-framework";
import type { EventBus } from "./bus.ts";
import { subscribeToAll } from "./subscriptions.ts";
import type { WorkflowEvent } from "./events.ts";

// Logging/Audit §2/§3 — every event, unconditionally, becomes a log entry.
// No filtering by Execution Tier or event type: subscribing to "*" is the
// only way an entry reaches this sink, so there is no code path for an
// event to happen and not be captured (NFR-7).
export interface LogEntry {
  readonly event: WorkflowEvent;
  readonly loggedAt: number;
}

export interface LogSink {
  readonly entries: readonly LogEntry[];
}

export function attachLogSink(bus: EventBus): LogSink {
  const entries: LogEntry[] = [];
  subscribeToAll(bus, (event) => {
    entries.push({ event, loggedAt: Date.now() });
  });
  return { entries };
}

// Logging/Audit §1 — the required fields per Task, reconstructed from the
// raw event stream (§5's example: "Research started 10:00, ended 10:14...").
export interface TaskLogEntry {
  readonly taskId: string;
  readonly roleId: RoleId;
  readonly startedAt?: number;
  readonly endedAt?: number;
  readonly decisions: readonly AgentDecision[];
  readonly errors: readonly AgentError[];
  readonly warnings: readonly string[];
  readonly result?: "success" | "needs_revision" | "failed";
}

interface MutableTaskLogEntry {
  roleId: RoleId;
  startedAt?: number;
  endedAt?: number;
  decisions: AgentDecision[];
  errors: AgentError[];
  warnings: string[];
  result?: "success" | "needs_revision" | "failed";
}

export function reconstructJournal(events: readonly WorkflowEvent[]): readonly TaskLogEntry[] {
  const byTask = new Map<string, MutableTaskLogEntry>();

  for (const event of events) {
    if (!("taskId" in event)) continue;
    const entry: MutableTaskLogEntry =
      byTask.get(event.taskId) ?? { roleId: event.roleId, decisions: [], errors: [], warnings: [] };

    switch (event.type) {
      case "task_started":
        entry.startedAt = event.at;
        break;
      case "task_succeeded":
        entry.endedAt = event.at;
        entry.result = "success";
        entry.decisions = [...entry.decisions, ...event.decisions];
        break;
      case "task_needs_revision":
        entry.warnings = [...entry.warnings, event.reason];
        entry.result = "needs_revision";
        break;
      case "task_failed":
        entry.endedAt = event.at;
        entry.result = "failed";
        entry.errors = [...entry.errors, event.error];
        break;
      default:
        break;
    }

    byTask.set(event.taskId, entry);
  }

  return [...byTask.entries()].map(([taskId, entry]) => ({ taskId, ...entry }));
}
