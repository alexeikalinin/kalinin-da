import type { InvocationContext } from "@ama/agent-framework";
import type { MemoryStore } from "@ama/memory";
import type { RoleTemplate } from "@ama/prompt-architecture";
import type { CredentialStore, ToolInvoker, ToolRegistry } from "@ama/tools";
import type { ModelCatalog, TaskComplexity } from "@ama/cost-router";
import { prepareAgentInvocation } from "@ama/workflow-engine";
import type { FrontendTaskPayload } from "./frontend-agent.ts";

const MEMORY_LEVELS = ["task", "project"] as const;
const DEPLOY_TOOL_ID = "deployment-tool";

export interface PrepareFrontendInvocationInput {
  readonly store: MemoryStore;
  readonly registry: ToolRegistry;
  readonly credentials: CredentialStore;
  readonly catalog: ModelCatalog;
  readonly template: RoleTemplate;
  readonly context: Readonly<InvocationContext>;
  readonly taskDescription: string;
  readonly materials: Readonly<Record<string, unknown>>;
  readonly complexity: TaskComplexity;
  readonly invokeTool: ToolInvoker;
}

export function prepareFrontendInvocation(input: PrepareFrontendInvocationInput) {
  return prepareAgentInvocation<FrontendTaskPayload>({
    store: input.store,
    registry: input.registry,
    credentials: input.credentials,
    catalog: input.catalog,
    template: input.template,
    context: input.context,
    taskDescription: input.taskDescription,
    clientFactKeys: [],
    memoryLevels: [...MEMORY_LEVELS],
    toolIds: [DEPLOY_TOOL_ID],
    complexity: input.complexity,
    invokeTool: input.invokeTool,
    buildPayload: (prompt, modelId) => ({ prompt, modelId, materials: input.materials }),
  });
}
