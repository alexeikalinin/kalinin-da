import type { InvocationContext } from "@ama/agent-framework";
import type { MemoryStore } from "@ama/memory";
import type { RoleTemplate } from "@ama/prompt-architecture";
import type { CredentialStore, ToolInvoker, ToolRegistry } from "@ama/tools";
import type { ModelCatalog, TaskComplexity } from "@ama/cost-router";
import { prepareAgentInvocation } from "@ama/workflow-engine";
import type { PpcTaskPayload } from "./ppc-agent.ts";

const MEMORY_LEVELS = ["task", "project", "client_kb"] as const;

export interface PreparePpcInvocationInput {
  readonly store: MemoryStore;
  readonly registry: ToolRegistry;
  readonly credentials: CredentialStore;
  readonly catalog: ModelCatalog;
  readonly template: RoleTemplate;
  readonly context: Readonly<InvocationContext>;
  readonly taskDescription: string;
  readonly clientFactKeys: readonly string[];
  readonly channels: readonly string[];
  readonly complexity: TaskComplexity;
  readonly invokeTool: ToolInvoker;
  readonly googleAdsCustomerId?: string;
  readonly yandexClientLogin?: string;
}

// Thin, role-specific wrapper over @ama/workflow-engine's generic
// prepareAgentInvocation — see that module for what this actually does.
export function preparePpcInvocation(input: PreparePpcInvocationInput) {
  return prepareAgentInvocation<PpcTaskPayload>({
    store: input.store,
    registry: input.registry,
    credentials: input.credentials,
    catalog: input.catalog,
    template: input.template,
    context: input.context,
    taskDescription: input.taskDescription,
    clientFactKeys: input.clientFactKeys,
    memoryLevels: [...MEMORY_LEVELS],
    toolIds: input.channels,
    complexity: input.complexity,
    invokeTool: input.invokeTool,
    buildPayload: (prompt, modelId) => ({
      prompt,
      modelId,
      channels: input.channels,
      googleAdsCustomerId: input.googleAdsCustomerId,
      yandexClientLogin: input.yandexClientLogin,
    }),
  });
}
