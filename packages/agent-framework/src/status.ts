// Shared error/decision protocol — Agent Framework §4.

export interface AgentDecision {
  readonly summary: string;
}

export interface AgentError {
  readonly code: string;
  readonly message: string;
  // Drives Recovery §3 (retry vs escalate vs block) — not decided here.
  readonly retryable: boolean;
}
