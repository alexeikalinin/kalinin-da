import type { ProjectRecord } from "./orchestrator.ts";

// FR-3 (progress) / FR-6 (output) response shape. GraphState.states is a
// Map, not JSON-serializable directly — this is the one translation layer
// between the domain model and the wire format.
export function serializeProject(record: ProjectRecord) {
  return {
    projectId: record.projectId,
    status: record.planStatus,
    input: record.input,
    approvalLevel: record.approvalLevel,
    executionTier: record.executionTier,
    planSummary: record.planSummary,
    plan: record.graph?.nodes.map((n) => ({ taskId: n.taskId, roleId: n.roleId, dependsOn: n.dependsOn })),
    progress: record.graphState ? Object.fromEntries(record.graphState.states) : undefined,
    hasOutput: Boolean(record.output),
    rejectionComments: record.rejectionComments,
    reworkComments: record.reworkComments,
    createdAt: record.createdAt,
  };
}
