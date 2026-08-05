import type { TenantId } from "@ama/agent-framework";
import type { Actor, MemoryStore } from "@ama/memory";

export type Guidance =
  | { readonly source: "client_kb"; readonly value: unknown }
  | { readonly source: "learning"; readonly value: unknown }
  | { readonly source: "none" };

// Learning System §5 — a confirmed Knowledge Base fact about the client
// always wins over a statistical Learning Memory conclusion at the same
// key. Learning Memory never overrides an explicit statement about a
// specific client (Memory System §2's distinction between a confirmed fact
// and a self-derived conclusion).
export function pickGuidance(
  store: MemoryStore,
  actor: Actor,
  tenantId: TenantId,
  key: string,
): Guidance {
  const kbValue = store.read(actor, { level: "client_kb", tenantId, key });
  if (kbValue !== undefined) return { source: "client_kb", value: kbValue };

  const learningValue = store.read(actor, { level: "learning", tenantId, key });
  if (learningValue !== undefined) return { source: "learning", value: learningValue };

  return { source: "none" };
}
