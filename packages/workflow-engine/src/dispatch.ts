import {
  asTaskId,
  createInvocationContext,
  type ApprovalLevel,
  type ExecutionTier,
  type InvocationContext,
  type ProjectId,
  type TenantId,
} from "@ama/agent-framework";
import type { WorkflowNode } from "./graph.ts";

// Project-level facts every dispatched Task shares — everything else
// (taskId, roleId) comes from the graph node itself.
export interface ProjectContext {
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly executionTier: ExecutionTier;
  readonly approvalLevel: ApprovalLevel;
}

// Queue §5 (isolation fix, added after the independent technical review):
// a fresh, immutable context is derived per Task at dispatch time — never
// reused or mutated across invocations on the same worker.
export function createDispatchContext(
  node: WorkflowNode,
  project: ProjectContext,
): InvocationContext {
  return createInvocationContext({
    tenantId: project.tenantId,
    projectId: project.projectId,
    taskId: asTaskId(node.taskId),
    roleId: node.roleId,
    executionTier: project.executionTier,
    approvalLevel: project.approvalLevel,
  });
}
