import type { InvocationContext, ToolPort } from "@ama/agent-framework";
import type { Actor } from "@ama/memory";
import type { CredentialStore } from "./credentials.ts";
import type { ToolRegistry } from "./registry.ts";
import { invokeWithRetry, type ToolInvoker } from "./invoke.ts";

// Turns the registry + credentials + a real invoker into the narrow
// ToolPort an agent actually sees — this is where "a role only gets the
// tools it declared" (Agent Framework §1 / Tool Integration §2) becomes an
// enforced boundary, exactly the same pattern @ama/memory uses for
// createAgentMemoryPort.
export function createAgentToolPort(
  registry: ToolRegistry,
  credentials: CredentialStore,
  context: Readonly<InvocationContext>,
  allowedToolIds: readonly string[],
  invoke: ToolInvoker,
): ToolPort {
  const actor: Actor = { kind: "agent", tenantId: context.tenantId };

  return {
    async invoke(toolId, args) {
      if (!allowedToolIds.includes(toolId)) {
        throw new Error(
          `Role "${context.roleId}" is not scoped to tool "${toolId}" (Tool Integration §2).`,
        );
      }
      if (!registry.isApproved(toolId)) {
        throw new Error(
          `Tool "${toolId}" is not an approved tool type (Tool Integration, Open Question #1).`,
        );
      }
      const credential = credentials.get(actor, toolId);
      return invokeWithRetry(invoke, toolId, args, credential);
    },
  };
}
