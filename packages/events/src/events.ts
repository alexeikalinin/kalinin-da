import type {
  AgentDecision,
  AgentError,
  ProjectId,
  RoleId,
  TaskId,
  TenantId,
} from "@ama/agent-framework";

// Events §1 — the minimal event set for the reference scenario.
// Every event carries tenantId/projectId/at so Logging/Audit (§2, "все
// события без исключения") never has to guess where an event belongs.

interface EventBase {
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly at: number;
}

export interface ProjectCreated extends EventBase {
  readonly type: "project_created";
}

export interface PlanReady extends EventBase {
  readonly type: "plan_ready";
}

export interface PlanApproved extends EventBase {
  readonly type: "plan_approved";
}

export interface PlanRejected extends EventBase {
  readonly type: "plan_rejected";
  readonly comment?: string;
}

interface TaskEventBase extends EventBase {
  readonly taskId: TaskId;
  readonly roleId: RoleId;
}

export interface TaskQueued extends TaskEventBase {
  readonly type: "task_queued";
}

export interface TaskStarted extends TaskEventBase {
  readonly type: "task_started";
}

export interface TaskSucceeded extends TaskEventBase {
  readonly type: "task_succeeded";
  // Logging/Audit §1 lists "Принятые решения" as a required journal field —
  // carried here rather than reconstructed separately, since Agent
  // Framework's AgentOutput already produces it (§4).
  readonly decisions: readonly AgentDecision[];
}

export interface TaskNeedsRevision extends TaskEventBase {
  readonly type: "task_needs_revision";
  readonly reason: string;
}

export interface TaskFailed extends TaskEventBase {
  readonly type: "task_failed";
  readonly error: AgentError;
}

// Queue §4 — a Task picked up but not finished in time.
export interface TaskStuck extends TaskEventBase {
  readonly type: "task_stuck";
}

export interface ProjectCompleted extends EventBase {
  readonly type: "project_completed";
}

export type WorkflowEvent =
  | ProjectCreated
  | PlanReady
  | PlanApproved
  | PlanRejected
  | TaskQueued
  | TaskStarted
  | TaskSucceeded
  | TaskNeedsRevision
  | TaskFailed
  | TaskStuck
  | ProjectCompleted;

export type WorkflowEventType = WorkflowEvent["type"];
