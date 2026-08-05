import type { ApprovalLevel, ExecutionTier, RoleId } from "@ama/agent-framework";

// Cost Optimization §4 — an abstract "model tier," not a provider-specific
// model name. Today this maps onto Anthropic's lineup (ADR-0003); adding a
// provider later means teaching a ModelCatalog about this same tier, not
// touching the Router or Agent Framework.
export type ModelTier = "fast" | "base" | "advanced";

// How demanding/creative the Task itself is — the doc's own examples:
// "написать 20 вариантов объявлений" (routine) vs "сформировать стратегию"
// (complex). Deliberately just 3 buckets, supplied by the caller per Task —
// this is not where role-specific calibration happens (Open Question #1).
export type TaskComplexity = "routine" | "standard" | "complex";

export interface ModelSelectionInput {
  readonly complexity: TaskComplexity;
  readonly executionTier: ExecutionTier;
  readonly approvalLevel: ApprovalLevel;
  readonly roleId: RoleId; // carried through for cost tracking (§3), not branched on here
}

export type ModelSelector = (input: ModelSelectionInput) => ModelTier;

const TIER_ORDER: readonly ModelTier[] = ["fast", "base", "advanced"];

function baseTierForComplexity(complexity: TaskComplexity): ModelTier {
  if (complexity === "routine") return "fast";
  if (complexity === "standard") return "base";
  return "advanced";
}

function nudgeDown(tier: ModelTier, steps: number): ModelTier {
  const index = Math.max(0, TIER_ORDER.indexOf(tier) - steps);
  return TIER_ORDER[index]!;
}

// Cost Optimization §1 — the qualitative principle, not the exact
// calibration table (that table is Open Question #1, deliberately deferred
// to practice on the reference scenario):
//   - complexity sets the baseline tier;
//   - Fast Execution Tier nudges the tier down (cheaper/faster is the point
//     of choosing Fast at all);
//   - Strategy-gate nudges it down too — a draft that you'll review anyway
//     doesn't need the most expensive model to get there.
export const defaultModelSelector: ModelSelector = (input) => {
  let tier = baseTierForComplexity(input.complexity);
  if (input.executionTier === "fast") tier = nudgeDown(tier, 1);
  if (input.approvalLevel === "strategy-gate") tier = nudgeDown(tier, 1);
  return tier;
};
