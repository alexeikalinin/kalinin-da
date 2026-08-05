import type { Actor, MemoryStore, Proposal } from "@ama/memory";
import { resolveProposal, type ProposalResolution } from "@ama/knowledge-base";

// Learning System §4 — a pattern confirmed across multiple different
// tenants of the same owner may be proposed for promotion to the shared
// Domain KB, exactly like a significant Knowledge Base fact: staged, never
// applied without confirmation. Reusing Knowledge Base's resolveProposal
// (rather than a bare store.confirmProposal) also gets the same conflict
// check for free, per "по той же логике" in the doc.
export function proposeGeneralizedLesson(
  store: MemoryStore,
  reflectionActor: Actor, // domain_kb is shared, so any tenant works here
  key: string,
  conclusion: string,
): Proposal {
  return store.proposeFact(
    reflectionActor,
    { level: "domain_kb", tenantId: reflectionActor.tenantId, key },
    conclusion,
  );
}

export function confirmGeneralizedLesson(
  store: MemoryStore,
  approver: Actor,
  proposal: Proposal,
): ProposalResolution {
  return resolveProposal(store, approver, proposal);
}
