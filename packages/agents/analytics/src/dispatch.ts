import type { InvocationContext } from "@ama/agent-framework";
import type { MemoryStore } from "@ama/memory";
import type { RoleTemplate } from "@ama/prompt-architecture";
import type { CredentialStore, ToolInvoker, ToolRegistry } from "@ama/tools";
import type { ModelCatalog, TaskComplexity } from "@ama/cost-router";
import { prepareAgentInvocation } from "@ama/workflow-engine";
import type { AnalyticsTaskPayload } from "./analytics-agent.ts";

const MEMORY_LEVELS = ["task", "project", "client_kb"] as const;
const DEFAULT_ANALYTICS_TOOL_IDS = ["google-analytics", "yandex-metrika"] as const;

export interface PrepareAnalyticsInvocationInput {
  readonly store: MemoryStore;
  readonly registry: ToolRegistry;
  readonly credentials: CredentialStore;
  readonly catalog: ModelCatalog;
  readonly template: RoleTemplate;
  readonly context: Readonly<InvocationContext>;
  readonly taskDescription: string;
  readonly clientFactKeys: readonly string[];
  // Keys of other Tasks' archived output in Project Memory, e.g.
  // `${ppcTaskId}:campaign-summary` after archiveTaskIntoProject.
  readonly projectContextKeys: readonly string[];
  readonly complexity: TaskComplexity;
  readonly invokeTool: ToolInvoker;
  readonly projectDisplayName: string;
  readonly siteUrl: string;
  readonly gtmAccountId?: string;
  readonly gaAccountId?: string;
  readonly googleAdsCustomerId?: string;
  readonly analyticsToolIds?: readonly string[];
}

export function prepareAnalyticsInvocation(input: PrepareAnalyticsInvocationInput) {
  const analyticsToolIds = input.analyticsToolIds ?? DEFAULT_ANALYTICS_TOOL_IDS;
  return prepareAgentInvocation<AnalyticsTaskPayload>({
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
    toolIds: [...analyticsToolIds],
    complexity: input.complexity,
    invokeTool: input.invokeTool,
    buildPayload: (prompt, modelId) => ({
      prompt,
      modelId,
      analyticsToolIds,
      projectDisplayName: input.projectDisplayName,
      siteUrl: input.siteUrl,
      gtmAccountId: input.gtmAccountId,
      gaAccountId: input.gaAccountId,
      googleAdsCustomerId: input.googleAdsCustomerId,
    }),
  });
}
