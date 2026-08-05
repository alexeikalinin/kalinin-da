import type { InvocationContext } from "@ama/agent-framework";
import type { MemoryStore } from "@ama/memory";
import type { RoleTemplate } from "@ama/prompt-architecture";
import type { CredentialStore, ToolInvoker, ToolRegistry } from "@ama/tools";
import type { ModelCatalog, TaskComplexity } from "@ama/cost-router";
import { prepareAgentInvocation } from "@ama/workflow-engine";
import type { UiDesignerTaskPayload } from "./ui-designer-agent.ts";

const MEMORY_LEVELS = ["task", "project", "client_kb"] as const;
const DESIGN_TOOL_ID = "design-tool";

export interface PrepareUiDesignerInvocationInput {
  readonly store: MemoryStore;
  readonly registry: ToolRegistry;
  readonly credentials: CredentialStore;
  readonly catalog: ModelCatalog;
  readonly template: RoleTemplate;
  readonly context: Readonly<InvocationContext>;
  readonly taskDescription: string;
  readonly clientFactKeys: readonly string[];
  // e.g. ["ux-plan"] — UX's Project Memory key (Memory System §1).
  readonly projectContextKeys: readonly string[];
  readonly complexity: TaskComplexity;
  readonly invokeTool: ToolInvoker;
}

export function prepareUiDesignerInvocation(input: PrepareUiDesignerInvocationInput) {
  return prepareAgentInvocation<UiDesignerTaskPayload>({
    store: input.store,
    registry: input.registry,
    credentials: input.credentials,
    catalog: input.catalog,
    template: input.template,
    context: input.context,
    taskDescription: input.taskDescription,
    clientFactKeys: input.clientFactKeys,
    projectContextKeys: input.projectContextKeys,
    memoryLevels: [...MEMORY_LEVELS],
    toolIds: [DESIGN_TOOL_ID],
    complexity: input.complexity,
    invokeTool: input.invokeTool,
    buildPayload: (prompt, modelId) => ({ prompt, modelId, designToolId: DESIGN_TOOL_ID }),
  });
}
