import type { Actor, MemoryRef, MemoryStore } from "@ama/memory";
import { resolveProposal, type ProposalResolution } from "./resolve.ts";

// Knowledge Base §2, source 1 — you stating a fact directly (e.g. when
// creating a Project) skips the wait for confirmation, since you *are* the
// confirming authority. It still runs through the same conflict check as
// everything else (§3) — "direct" means "no wait", not "no check".
export function recordFactDirectly(
  store: MemoryStore,
  approver: Actor, // must be actor.kind === "approver"
  ref: MemoryRef, // level must be "domain_kb" or "client_kb"
  value: unknown,
): ProposalResolution {
  const proposal = store.proposeFact(approver, ref, value);
  return resolveProposal(store, approver, proposal);
}
