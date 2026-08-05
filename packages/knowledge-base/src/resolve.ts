import type { Actor, MemoryRecord, MemoryStore, Proposal } from "@ama/memory";

export interface ConflictResolution {
  readonly outcome: "conflict";
  readonly existing: MemoryRecord;
  readonly proposal: Proposal;
}

export interface ConfirmedResolution {
  readonly outcome: "confirmed";
  readonly record: MemoryRecord;
}

export type ProposalResolution = ConfirmedResolution | ConflictResolution;

// Knowledge Base §3 — a proposal that contradicts an already-confirmed fact
// at the same key is never silently overwritten. "Contradiction" here means
// exactly what §3's example does: a different value already confirmed for
// the same fact. Deeper semantic contradiction (different keys implying
// opposite things) is out of scope — that's a judgment call for whoever
// resolves the conflict, not something this function infers.
export function resolveProposal(
  store: MemoryStore,
  actor: Actor,
  proposal: Proposal,
): ProposalResolution {
  const existing = store.readRecord(actor, {
    level: proposal.level,
    tenantId: proposal.tenantId,
    key: proposal.key,
  });

  if (existing && existing.value !== proposal.value) {
    return { outcome: "conflict", existing, proposal };
  }

  const record = store.confirmProposal(actor, proposal.id);
  return { outcome: "confirmed", record };
}
