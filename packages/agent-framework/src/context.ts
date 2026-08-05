import type { ApprovalLevel, ExecutionTier } from "./execution.ts";
import type { ProjectId, RoleId, TaskId, TenantId } from "./ids.ts";

// Immutable per-invocation context — Queue §5 (added after the independent
// technical review flagged that tenant isolation across a shared worker pool
// had no enforcement mechanism, only stated intent). Once created, a context
// cannot be reassigned or mutated, and it must be re-derived per Task rather
// than reused across invocations on the same worker.
export interface InvocationContext {
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly taskId: TaskId;
  readonly roleId: RoleId;
  readonly executionTier: ExecutionTier;
  readonly approvalLevel: ApprovalLevel;
}

export function createInvocationContext(
  fields: InvocationContext,
): Readonly<InvocationContext> {
  return Object.freeze({ ...fields });
}
