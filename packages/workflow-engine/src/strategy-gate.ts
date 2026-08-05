import type { ApprovalLevel } from "@ama/agent-framework";

// Workflow Engine §3.
export type PlanStatus =
  | "building"
  | "awaiting_approval"
  | "executing"
  | "completed";

export function statusAfterPlanBuilt(approvalLevel: ApprovalLevel): PlanStatus {
  return approvalLevel === "strategy-gate" ? "awaiting_approval" : "executing";
}

export function approvePlan(status: PlanStatus): PlanStatus {
  if (status !== "awaiting_approval") {
    throw new Error(
      `Cannot approve a plan in status "${status}" — only "awaiting_approval" plans can be approved.`,
    );
  }
  return "executing";
}

// Workflow Engine §3, step 2: rejecting sends control back to PM Agent to
// rebuild the plan — it does not cancel the Project.
export function rejectPlan(status: PlanStatus): PlanStatus {
  if (status !== "awaiting_approval") {
    throw new Error(
      `Cannot reject a plan in status "${status}" — only "awaiting_approval" plans can be rejected.`,
    );
  }
  return "building";
}
