import type { InvocationContext } from "@ama/agent-framework";
import type { MemoryStore } from "@ama/memory";
import type { RoleTemplate } from "@ama/prompt-architecture";
import type { CredentialStore, ToolInvoker, ToolRegistry } from "@ama/tools";
import type { ModelCatalog, TaskComplexity } from "@ama/cost-router";
import { prepareAgentInvocation } from "@ama/workflow-engine";
import type { ReplyClassifierTaskPayload } from "./reply-classifier-agent.ts";

const MEMORY_LEVELS = ["task", "project"] as const;
const TOOL_IDS = ["prospect-store"] as const;

export interface PrepareReplyClassifierInvocationInput {
  readonly store: MemoryStore;
  readonly registry: ToolRegistry;
  readonly credentials: CredentialStore;
  readonly catalog: ModelCatalog;
  readonly template: RoleTemplate;
  readonly context: Readonly<InvocationContext>;
  readonly taskDescription: string;
  readonly outreachMessageId: string;
  readonly replyText: string;
  readonly complexity: TaskComplexity;
  readonly invokeTool: ToolInvoker;
}

export function prepareReplyClassifierInvocation(input: PrepareReplyClassifierInvocationInput) {
  return prepareAgentInvocation<ReplyClassifierTaskPayload>({
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
      outreachMessageId: input.outreachMessageId,
      replyText: input.replyText,
    }),
  });
}
