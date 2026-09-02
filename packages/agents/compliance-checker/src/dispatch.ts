import type { InvocationContext } from "@ama/agent-framework";
import type { MemoryStore } from "@ama/memory";
import type { RoleTemplate } from "@ama/prompt-architecture";
import type { CredentialStore, ToolInvoker, ToolRegistry } from "@ama/tools";
import type { ModelCatalog, TaskComplexity } from "@ama/cost-router";
import { prepareAgentInvocation } from "@ama/workflow-engine";
import type { ComplianceCheckerTaskPayload } from "./compliance-checker-agent.ts";

const MEMORY_LEVELS = ["task", "project"] as const;
const TOOL_IDS = ["prospect-store"] as const;

export interface PrepareComplianceCheckerInvocationInput {
  readonly store: MemoryStore;
  readonly registry: ToolRegistry;
  readonly credentials: CredentialStore;
  readonly catalog: ModelCatalog;
  readonly template: RoleTemplate;
  readonly context: Readonly<InvocationContext>;
  readonly taskDescription: string;
  readonly outreachMessageId: string;
  readonly complexity: TaskComplexity;
  readonly invokeTool: ToolInvoker;
}

// Still routed through the generic prepareAgentInvocation (prompt/model
// selection happen here even though this role's handler never calls a
// model) — keeps the dispatch shape identical across every role, which
// matters more than saving one unused prompt assembly for a role this
// cheap to run.
export function prepareComplianceCheckerInvocation(input: PrepareComplianceCheckerInvocationInput) {
  return prepareAgentInvocation<ComplianceCheckerTaskPayload>({
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
    buildPayload: () => ({ outreachMessageId: input.outreachMessageId }),
  });
}
