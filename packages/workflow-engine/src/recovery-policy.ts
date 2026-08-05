import type { ExecutionTier } from "@ama/agent-framework";

// Recovery §3: retry limits by Execution Tier. Placeholder values —
// explicitly a calibration decision deferred to after the first real run
// (Backlog #12, Risk Register RISK-05), not a considered final number.
const MAX_RETRIES: Record<ExecutionTier, number> = {
  fast: 1,
  standard: 3,
};

export type FailureDecision = "retry" | "escalate" | "block";

// Recovery §3 table:
//   not retryable (systemic, e.g. missing credentials) -> block immediately
//   retryable, under the tier's limit -> retry
//   retryable, limit exhausted -> escalate to the user
export function decideOnFailure(
  tier: ExecutionTier,
  attemptsSoFar: number,
  errorRetryable: boolean,
): FailureDecision {
  if (!errorRetryable) return "block";
  return attemptsSoFar < MAX_RETRIES[tier] ? "retry" : "escalate";
}
