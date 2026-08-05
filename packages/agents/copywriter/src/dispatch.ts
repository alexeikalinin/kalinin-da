import type { InvocationContext } from "@ama/agent-framework";
import type { MemoryStore } from "@ama/memory";
import type { RoleTemplate } from "@ama/prompt-architecture";
import type { CredentialStore, ToolInvoker, ToolRegistry } from "@ama/tools";
import type { ModelCatalog, TaskComplexity } from "@ama/cost-router";
import { prepareAgentInvocation } from "@ama/workflow-engine";
import type { CopywriterTaskPayload } from "./copywriter-agent.ts";

const MEMORY_LEVELS = ["task", "project", "client_kb"] as const;

export interface PrepareCopywriterInvocationInput {
  readonly store: MemoryStore;
  readonly registry: ToolRegistry;
  readonly credentials: CredentialStore;
  readonly catalog: ModelCatalog;
  readonly template: RoleTemplate;
  readonly context: Readonly<InvocationContext>;
  readonly taskDescription: string;
  readonly clientFactKeys: readonly string[];
  readonly briefs: readonly string[];
  readonly complexity: TaskComplexity;
  readonly invokeTool: ToolInvoker;
}

export function prepareCopywriterInvocation(input: PrepareCopywriterInvocationInput) {
  return prepareAgentInvocation<CopywriterTaskPayload>({
    store: input.store,
    registry: input.registry,
    credentials: input.credentials,
    catalog: input.catalog,
    template: input.template,
    context: input.context,
    taskDescription: input.taskDescription,
    clientFactKeys: input.clientFactKeys,
    memoryLevels: [...MEMORY_LEVELS],
    toolIds: [],
    complexity: input.complexity,
    invokeTool: input.invokeTool,
    buildPayload: (prompt, modelId) => ({ prompt, modelId, briefs: input.briefs }),
  });
}
