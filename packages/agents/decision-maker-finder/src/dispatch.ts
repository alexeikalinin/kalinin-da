import type { InvocationContext } from "@ama/agent-framework";
import type { MemoryStore } from "@ama/memory";
import type { RoleTemplate } from "@ama/prompt-architecture";
import type { CredentialStore, ToolInvoker, ToolRegistry } from "@ama/tools";
import type { ModelCatalog, TaskComplexity } from "@ama/cost-router";
import { prepareAgentInvocation } from "@ama/workflow-engine";
import type { DecisionMakerFinderTaskPayload } from "./decision-maker-finder-agent.ts";

const MEMORY_LEVELS = ["task", "project"] as const;
const TOOL_IDS = ["web-search", "site-reader", "prospect-store"] as const;

export interface PrepareDecisionMakerFinderInvocationInput {
  readonly store: MemoryStore;
  readonly registry: ToolRegistry;
  readonly credentials: CredentialStore;
  readonly catalog: ModelCatalog;
  readonly template: RoleTemplate;
  readonly context: Readonly<InvocationContext>;
  readonly taskDescription: string;
  readonly prospectAgencyId: string;
  readonly websiteUrl: string;
  readonly complexity: TaskComplexity;
  readonly invokeTool: ToolInvoker;
}

export function prepareDecisionMakerFinderInvocation(input: PrepareDecisionMakerFinderInvocationInput) {
  return prepareAgentInvocation<DecisionMakerFinderTaskPayload>({
    store: input.store,
    registry: input.registry,
    credentials: input.credentials,
    catalog: input.catalog,
    template: input.template,
    context: input.context,
    taskDescription: input.taskDescription,
    clientFactKeys: [],
    memoryLevels: [...MEMORY_LEVELS],
    toolIds: [...TOOL_IDS],
    complexity: input.complexity,
    invokeTool: input.invokeTool,
    buildPayload: (prompt, modelId) => ({
      prompt,
      modelId,
      prospectAgencyId: input.prospectAgencyId,
      websiteUrl: input.websiteUrl,
    }),
  });
}
