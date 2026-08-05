import type { Actor, MemoryStore, Proposal } from "@ama/memory";
import { resolveProposal, type ProposalResolution } from "./resolve.ts";

export type Significance = "minor" | "significant";

export interface ReviewOutcome {
  readonly significance: Significance;
  // Present only when auto-confirmed (significance === "minor").
  // A "significant" proposal is left pending — it requires a human
  // approver to call resolveProposal directly (Strategy-gate-like pause).
  readonly resolution?: ProposalResolution;
}

// Knowledge Base §2, source 2+3 — an agent's finding becomes a Proposed
// Fact, then PM Agent/Agent Architect classifies it. The classification
// itself ("what counts as significant") is Knowledge Base Open Question #1
// — deliberately left unresolved pending real examples from the reference
// scenario. This function only encodes what happens *given* a
// classification, so the caller supplies the judgment call rather than this
// package guessing at a threshold that isn't ready to be fixed yet.
export function reviewProposal(
  store: MemoryStore,
  systemActor: Actor, // must be actor.kind === "system"
  proposal: Proposal,
  significance: Significance,
): ReviewOutcome {
  if (significance === "significant") {
    return { significance };
  }
  return { significance, resolution: resolveProposal(store, systemActor, proposal) };
}
