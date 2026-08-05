// Execution Tier and Approval Level — Functional Requirements FR-2, FR-2a.

export type ExecutionTier = "fast" | "standard";

export type ApprovalLevel = "output-only" | "strategy-gate";

// Decision 2026-08-04 (Functional Requirements, FR-2 Decision Log): safer default.
export const DEFAULT_APPROVAL_LEVEL: ApprovalLevel = "strategy-gate";
