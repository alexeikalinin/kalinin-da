import type { ExecutionTier, RoleId } from "@ama/agent-framework";
import type { ModelCatalog } from "./catalog.ts";
import type { ModelTier } from "./tiers.ts";

export interface HistoricalCostSource {
  averageCostForRole(roleId: RoleId): number | undefined;
}

// Cost Optimization §3 — accumulates real spend per role so the estimate
// can switch from the cold-start default to actual figures automatically,
// "без отдельного решения" (no explicit cutover step).
export class RunningCostHistory implements HistoricalCostSource {
  #totals = new Map<string, { sum: number; count: number }>();

  record(roleId: RoleId, cost: number): void {
    const entry = this.#totals.get(roleId) ?? { sum: 0, count: 0 };
    entry.sum += cost;
    entry.count += 1;
    this.#totals.set(roleId, entry);
  }

  averageCostForRole(roleId: RoleId): number | undefined {
    const entry = this.#totals.get(roleId);
    return entry ? entry.sum / entry.count : undefined;
  }
}

// §3, "холодный старт": before any history exists, assume this many model
// calls per role — Standard allows more internal iteration (Workflow
// Engine §2), so it gets a higher default. Explicit calibration
// placeholder, same status as every other deferred threshold.
const EXPECTED_CALLS_PER_ROLE: Record<ExecutionTier, number> = {
  fast: 1,
  standard: 3,
};

export interface CostEstimateInput {
  readonly roles: readonly RoleId[];
  readonly executionTier: ExecutionTier;
}

export interface CostEstimate {
  readonly total: number;
  // Per role, so the caller can see which figures are real history vs the
  // rough cold-start default — useful for both transparency and testing.
  readonly perRole: ReadonlyMap<RoleId, { readonly cost: number; readonly source: "history" | "cold-start" }>;
}

export function estimateProjectCost(
  catalog: ModelCatalog,
  history: HistoricalCostSource,
  input: CostEstimateInput,
  coldStartTier: ModelTier = "base",
): CostEstimate {
  const perRole = new Map<RoleId, { cost: number; source: "history" | "cold-start" }>();
  let total = 0;

  for (const roleId of input.roles) {
    const historical = history.averageCostForRole(roleId);
    if (historical !== undefined) {
      perRole.set(roleId, { cost: historical, source: "history" });
      total += historical;
      continue;
    }
    const roughDefault = catalog.costPerCall(coldStartTier) * EXPECTED_CALLS_PER_ROLE[input.executionTier];
    perRole.set(roleId, { cost: roughDefault, source: "cold-start" });
    total += roughDefault;
  }

  return { total, perRole };
}
