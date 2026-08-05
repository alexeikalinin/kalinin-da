import { asRoleId } from "@ama/agent-framework";
import type { WorkflowNode } from "../graph.ts";

// Workflow Engine §1 — the reference scenario graph used consistently across
// docs/03-architecture: Research -> PPC/MediaBuyer (parallel) -> Analytics -> QA -> Report.
export function referenceScenarioNodes(): readonly WorkflowNode[] {
  return [
    { taskId: "research", roleId: asRoleId("research"), dependsOn: [] },
    { taskId: "ppc", roleId: asRoleId("ppc"), dependsOn: ["research"] },
    {
      taskId: "media-buyer",
      roleId: asRoleId("media-buyer"),
      dependsOn: ["research"],
    },
    {
      taskId: "analytics",
      roleId: asRoleId("analytics"),
      dependsOn: ["ppc", "media-buyer"],
    },
    { taskId: "qa", roleId: asRoleId("qa"), dependsOn: ["analytics"] },
    {
      taskId: "report",
      roleId: asRoleId("report-generator"),
      dependsOn: ["qa"],
    },
  ];
}
