import type { Actor } from "@ama/memory";

export interface ToolRegistryEntry {
  readonly toolId: string;
  readonly displayName: string;
}

// Tool Integration, Open Question #1 (closed 2026-08-04) — registering a
// new tool TYPE requires an approver, same logic as activating a new role
// (Agent Framework §4a). Issuing a new tenant's credential for an
// already-approved tool does NOT require this step again — see
// credentials.ts.
export class ToolRegistry {
  #approved = new Map<string, ToolRegistryEntry>();

  register(actor: Actor, entry: ToolRegistryEntry): void {
    if (actor.kind !== "approver") {
      throw new Error("Only an approver can register a new tool type.");
    }
    this.#approved.set(entry.toolId, entry);
  }

  isApproved(toolId: string): boolean {
    return this.#approved.has(toolId);
  }

  get(toolId: string): ToolRegistryEntry | undefined {
    return this.#approved.get(toolId);
  }
}
