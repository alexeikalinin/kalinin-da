import type { InvocationContext } from "@ama/agent-framework";
import type { MemoryStore } from "@ama/memory";
import type { RoleTemplate } from "@ama/prompt-architecture";
import type { CredentialStore, ToolInvoker, ToolRegistry } from "@ama/tools";
import type { ModelCatalog, TaskComplexity } from "@ama/cost-router";
import { prepareAgentInvocation } from "@ama/workflow-engine";
import type { QaTaskPayload } from "./qa-agent.ts";

const MEMORY_LEVELS = ["task", "project"] as const;

export interface PrepareQaInvocationInput {
  readonly store: MemoryStore;
  readonly registry: ToolRegistry;
  readonly credentials: CredentialStore;
  readonly catalog: ModelCatalog;
  readonly template: RoleTemplate;
  readonly context: Readonly<InvocationContext>;
  readonly taskDescription: string;
  readonly artifactToReview: unknown;
  readonly checklistId: string;
  readonly complexity: TaskComplexity;
  readonly invokeTool: ToolInvoker; // unused (no toolIds) but kept for a uniform call shape across roles
}

export function prepareQaInvocation(input: PrepareQaInvocationInput) {
  return prepareAgentInvocation<QaTaskPayload>({
    store: input.store,
    registry: input.registry,
    credentials: input.credentials,
    catalog: input.catalog,
    template: input.template,
    context: input.context,
    taskDescription: input.taskDescription,
    clientFactKeys: [],
    memoryLevels: [...MEMORY_LEVELS],
    toolIds: [],
    complexity: input.complexity,
    invokeTool: input.invokeTool,
    buildPayload: (prompt, modelId) => ({
      prompt,
      modelId,
      artifactToReview: input.artifactToReview,
      checklistId: input.checklistId,
    }),
  });
}
