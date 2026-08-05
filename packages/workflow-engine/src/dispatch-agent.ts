import type { AgentInput, InvocationContext, MemoryLevel } from "@ama/agent-framework";
import { createAgentMemoryPort, type Actor, type MemoryStore } from "@ama/memory";
import { assemblePrompt, type PromptBlocks, type RoleTemplate } from "@ama/prompt-architecture";
import {
  createAgentToolPort,
  type CredentialStore,
  type ToolInvoker,
  type ToolRegistry,
} from "@ama/tools";
import { defaultModelSelector, type ModelCatalog, type TaskComplexity } from "@ama/cost-router";

// What Workflow Engine's dispatch step actually does before invoking ANY
// agent, regardless of role: assemble the prompt (Prompt Architecture §1),
// pick a model tier (Cost Optimization §1), and hand the agent only the
// narrow MemoryPort/ToolPort it's scoped to — never raw MemoryStore access.
// Generalized out of @ama/agent-ppc's original dispatch.ts once a second
// role needed the identical wiring — same "document → code" rule as
// everywhere else in this codebase applies to duplication, not just docs.
export interface PrepareAgentInvocationInput<TPayload> {
  readonly store: MemoryStore;
  readonly registry: ToolRegistry;
  readonly credentials: CredentialStore;
  readonly catalog: ModelCatalog;
  readonly template: RoleTemplate;
  readonly context: Readonly<InvocationContext>;
  readonly taskDescription: string;
  readonly clientFactKeys: readonly string[];
  readonly domainFactKeys?: readonly string[];
  readonly projectContextKeys?: readonly string[];
  readonly memoryLevels: readonly MemoryLevel[];
  readonly toolIds: readonly string[];
  readonly complexity: TaskComplexity;
  readonly invokeTool: ToolInvoker;
  // Each role's payload shape differs (PPC needs `channels`, Analytics might
  // need a date range, etc.) — the role package supplies how to turn the
  // assembled prompt + chosen model into its own payload.
  readonly buildPayload: (prompt: PromptBlocks, modelId: string) => TPayload;
}

export function prepareAgentInvocation<TPayload>(
  input: PrepareAgentInvocationInput<TPayload>,
): { readonly agentInput: AgentInput<TPayload>; readonly modelId: string } {
  const actor: Actor = { kind: "agent", tenantId: input.context.tenantId };

  const prompt = assemblePrompt(input.store, actor, {
    context: input.context,
    template: input.template,
    taskDescription: input.taskDescription,
    clientFactKeys: input.clientFactKeys,
    domainFactKeys: input.domainFactKeys ?? [],
    projectContextKeys: input.projectContextKeys ?? [],
  });

  const tier = defaultModelSelector({
    complexity: input.complexity,
    executionTier: input.context.executionTier,
    approvalLevel: input.context.approvalLevel,
    roleId: input.context.roleId,
  });
  const modelId = input.catalog.resolve(tier);

  const memory = createAgentMemoryPort(input.store, input.context, input.memoryLevels);
  const tools = createAgentToolPort(
    input.registry,
    input.credentials,
    input.context,
    input.toolIds,
    input.invokeTool,
  );

  return {
    agentInput: {
      task: { context: input.context, payload: input.buildPayload(prompt, modelId) },
      memory,
      tools,
    },
    modelId,
  };
}
