import type { InvocationContext } from "@ama/agent-framework";
import type { MemoryStore } from "@ama/memory";
import type { RoleTemplate } from "@ama/prompt-architecture";
import type { CredentialStore, ToolInvoker, ToolRegistry } from "@ama/tools";
import type { ModelCatalog, TaskComplexity } from "@ama/cost-router";
import { prepareAgentInvocation } from "@ama/workflow-engine";
import type { CreativeTaskPayload } from "./creative-agent.ts";

const MEMORY_LEVELS = ["task", "project", "client_kb"] as const;
const CREATIVE_TOOL_ID = "creative-generation";

export interface PrepareCreativeInvocationInput {
  readonly store: MemoryStore;
  readonly registry: ToolRegistry;
  readonly credentials: CredentialStore;
  readonly catalog: ModelCatalog;
  readonly template: RoleTemplate;
  readonly context: Readonly<InvocationContext>;
  readonly taskDescription: string;
  readonly clientFactKeys: readonly string[];
  // Project Memory keys of the roles this one depends on, e.g.
  // ["<copyTaskId>:copy-draft", "media-budget-plan"] — Copywriter's
  // approved text and Media Buyer's audience/budget plan (Agent Framework
  // §1's "Взаимодействие с другими агентами": PM/Workflow Engine decide
  // the graph, this role only declares which keys it can use if present).
  // Same caveat as @ama/agent-ui-designer's projectContextKeys: assemblePrompt
  // only surfaces string-valued Project Memory entries, so a structured
  // object here won't actually appear as prompt text yet.
  readonly projectContextKeys: readonly string[];
  readonly channels: readonly string[];
  readonly complexity: TaskComplexity;
  readonly invokeTool: ToolInvoker;
}

export function prepareCreativeInvocation(input: PrepareCreativeInvocationInput) {
  return prepareAgentInvocation<CreativeTaskPayload>({
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
    toolIds: [CREATIVE_TOOL_ID],
    complexity: input.complexity,
    invokeTool: input.invokeTool,
    buildPayload: (prompt, modelId) => ({
      prompt,
      modelId,
      creativeToolId: CREATIVE_TOOL_ID,
      channels: input.channels,
    }),
  });
}
