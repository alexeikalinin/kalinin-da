import type {
  InvocationContext,
  MemoryLevel,
  MemoryPort,
} from "@ama/agent-framework";
import type { MemoryStore } from "./store.ts";

// Turns the general-purpose MemoryStore into the narrow MemoryPort an agent
// actually sees (Agent Framework §1, row "Память": a role only gets the
// levels it declared — this is where that becomes an enforced boundary,
// not just a claim in the role spec).
export function createAgentMemoryPort(
  store: MemoryStore,
  context: Readonly<InvocationContext>,
  allowedLevels: readonly MemoryLevel[],
): MemoryPort {
  const actor = { kind: "agent" as const, tenantId: context.tenantId };

  function assertAllowed(level: MemoryLevel): void {
    if (!allowedLevels.includes(level)) {
      throw new Error(
        `Role "${context.roleId}" is not scoped to memory level "${level}" (Agent Framework §1).`,
      );
    }
  }

  // MemoryStore's key is otherwise a bare string per tenant+level — without
  // this, two concurrent Projects (or two Tasks) for the same tenant would
  // silently collide on the same key (e.g. two Media Buyer runs both
  // writing "media-budget-plan"). Task Memory lives per Task, Project
  // Memory per Project (Memory System §1) — enforced here, not left to
  // every caller to remember to prefix.
  function scopedKey(level: MemoryLevel, key: string): string {
    if (level === "task") return `${context.taskId}:${key}`;
    if (level === "project") return `${context.projectId}:${key}`;
    return key;
  }

  return {
    async read(level, key) {
      assertAllowed(level);
      return store.read(actor, { level, tenantId: context.tenantId, key: scopedKey(level, key) });
    },

    async write(level, key, value) {
      assertAllowed(level);
      const key_ = scopedKey(level, key);

      if (level === "session" || level === "task" || level === "project") {
        store.write(actor, { level, tenantId: context.tenantId, key: key_ }, value);
        return;
      }

      if (level === "learning") {
        throw new Error(
          "Agents cannot write directly to Learning Memory — only Reflection can (Memory System §1).",
        );
      }

      // company / domain_kb / client_kb — Memory System §4: a finding
      // becomes a proposal, never a direct write.
      store.proposeFact(actor, { level, tenantId: context.tenantId, key: key_ }, value);
    },
  };
}
