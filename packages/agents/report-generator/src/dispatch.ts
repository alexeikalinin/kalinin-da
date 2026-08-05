import type { InvocationContext } from "@ama/agent-framework";
import type { MemoryStore } from "@ama/memory";
import type { RoleTemplate } from "@ama/prompt-architecture";
import type { CredentialStore, ToolInvoker, ToolRegistry } from "@ama/tools";
import type { ModelCatalog, TaskComplexity } from "@ama/cost-router";
import { prepareAgentInvocation } from "@ama/workflow-engine";
import type { ReportGeneratorTaskPayload, ReportMaterialRef } from "./report-generator-agent.ts";

const MEMORY_LEVELS = ["project"] as const;

export interface PrepareReportGeneratorInvocationInput {
  readonly store: MemoryStore;
  readonly registry: ToolRegistry;
  readonly credentials: CredentialStore;
  readonly catalog: ModelCatalog;
  readonly template: RoleTemplate;
  readonly context: Readonly<InvocationContext>;
  readonly taskDescription: string;
  readonly materialRefs: readonly ReportMaterialRef[];
  readonly complexity: TaskComplexity;
  readonly invokeTool: ToolInvoker; // unused (no toolIds) but kept for a uniform call shape across roles
}

export function prepareReportGeneratorInvocation(input: PrepareReportGeneratorInvocationInput) {
  return prepareAgentInvocation<ReportGeneratorTaskPayload>({
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
    buildPayload: (prompt, modelId) => ({ prompt, modelId, materialRefs: input.materialRefs }),
  });
}
