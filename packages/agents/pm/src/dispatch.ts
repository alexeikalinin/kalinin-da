import type { InvocationContext, RoleId } from "@ama/agent-framework";
import type { MemoryStore } from "@ama/memory";
import type { RoleTemplate } from "@ama/prompt-architecture";
import type { CredentialStore, ToolInvoker, ToolRegistry } from "@ama/tools";
import type { ModelCatalog, TaskComplexity } from "@ama/cost-router";
import { prepareAgentInvocation } from "@ama/workflow-engine";
import type { PmTaskPayload } from "./pm-agent.ts";

export interface PreparePmInvocationInput {
  readonly store: MemoryStore;
  readonly registry: ToolRegistry;
  readonly credentials: CredentialStore;
  readonly catalog: ModelCatalog;
  readonly template: RoleTemplate;
  readonly context: Readonly<InvocationContext>;
  readonly taskDescription: string;
  readonly availableRoleIds: readonly RoleId[];
  readonly strategySummary: string;
  readonly complexity: TaskComplexity;
  readonly invokeTool: ToolInvoker;
}

export function preparePmInvocation(input: PreparePmInvocationInput) {
  return prepareAgentInvocation<PmTaskPayload>({
    store: input.store,
    registry: input.registry,
    credentials: input.credentials,
    catalog: input.catalog,
    template: input.template,
    context: input.context,
    taskDescription: input.taskDescription,
    clientFactKeys: [],
    memoryLevels: ["project"],
    toolIds: [],
    complexity: input.complexity,
    invokeTool: input.invokeTool,
    buildPayload: (prompt, modelId) => ({
      prompt,
      modelId,
      availableRoleIds: input.availableRoleIds,
      strategySummary: input.strategySummary,
    }),
  });
}
