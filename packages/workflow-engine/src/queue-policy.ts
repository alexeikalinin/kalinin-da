import type { ExecutionTier } from "@ama/agent-framework";

// Queue §4 — a picked-up Task that hasn't finished in a reasonable time
// counts as stuck and goes back to the queue. Placeholder thresholds —
// explicit calibration debt (Backlog #13, Risk Register RISK-05), not a
// considered final number.
const STUCK_THRESHOLD_MS: Record<ExecutionTier, number> = {
  fast: 2 * 60 * 1000,
  standard: 15 * 60 * 1000,
};

export function isStuck(
  dispatchedAtMs: number,
  tier: ExecutionTier,
  nowMs: number,
): boolean {
  return nowMs - dispatchedAtMs > STUCK_THRESHOLD_MS[tier];
}
