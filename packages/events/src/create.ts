import type { AgentDecision, AgentError, ProjectId, RoleId, TaskId, TenantId } from "@ama/agent-framework";
import type {
  PlanApproved,
  PlanRejected,
  PlanReady,
  ProjectCompleted,
  ProjectCreated,
  TaskFailed,
  TaskNeedsRevision,
  TaskQueued,
  TaskStarted,
  TaskStuck,
  TaskSucceeded,
} from "./events.ts";

interface ProjectRef {
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
}

interface TaskRef extends ProjectRef {
  readonly taskId: TaskId;
  readonly roleId: RoleId;
}

// Centralizes the one bit every constructor would otherwise repeat: stamping `at`.
function now(): number {
  return Date.now();
}

export function projectCreated(ref: ProjectRef): ProjectCreated {
  return { type: "project_created", ...ref, at: now() };
}

export function planReady(ref: ProjectRef): PlanReady {
  return { type: "plan_ready", ...ref, at: now() };
}

export function planApproved(ref: ProjectRef): PlanApproved {
  return { type: "plan_approved", ...ref, at: now() };
}

export function planRejected(ref: ProjectRef, comment?: string): PlanRejected {
  return { type: "plan_rejected", ...ref, comment, at: now() };
}

export function taskQueued(ref: TaskRef): TaskQueued {
  return { type: "task_queued", ...ref, at: now() };
}

export function taskStarted(ref: TaskRef): TaskStarted {
  return { type: "task_started", ...ref, at: now() };
}

export function taskSucceeded(
  ref: TaskRef,
  decisions: readonly AgentDecision[] = [],
): TaskSucceeded {
  return { type: "task_succeeded", ...ref, decisions, at: now() };
}

export function taskNeedsRevision(ref: TaskRef, reason: string): TaskNeedsRevision {
  return { type: "task_needs_revision", ...ref, reason, at: now() };
}

export function taskFailed(ref: TaskRef, error: AgentError): TaskFailed {
  return { type: "task_failed", ...ref, error, at: now() };
}

export function taskStuck(ref: TaskRef): TaskStuck {
  return { type: "task_stuck", ...ref, at: now() };
}

export function projectCompleted(ref: ProjectRef): ProjectCompleted {
  return { type: "project_completed", ...ref, at: now() };
}
