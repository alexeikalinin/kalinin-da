import type { Actor } from "@ama/memory";

// Tool Integration §3 — a tenant's credential for a tool. Storage/rotation
// mechanism itself is Security's job (Open Question #2); this is the
// isolated lookup. Note the design: `get` takes only an Actor, never a raw
// tenantId — there is structurally no way to ask for another tenant's
// credential, not just an assertion that would reject it.
export class CredentialStore {
  #credentials = new Map<string, unknown>();

  issue(actor: Actor, toolId: string, credential: unknown): void {
    if (actor.kind !== "approver") {
      throw new Error("Only an approver can issue a tenant's credential for a tool.");
    }
    this.#credentials.set(`${toolId}:${actor.tenantId}`, credential);
  }

  get(actor: Actor, toolId: string): unknown {
    return this.#credentials.get(`${toolId}:${actor.tenantId}`);
  }
}
