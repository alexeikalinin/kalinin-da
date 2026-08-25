import type { InvocationContext } from "@ama/agent-framework";
import type { MemoryStore } from "@ama/memory";
import type { RoleTemplate } from "@ama/prompt-architecture";
import type { CredentialStore, ToolInvoker, ToolRegistry } from "@ama/tools";
import type { ModelCatalog, TaskComplexity } from "@ama/cost-router";
import { prepareAgentInvocation } from "@ama/workflow-engine";
import type { AnalyticsTaskPayload } from "./analytics-agent.ts";

const MEMORY_LEVELS = ["task", "project", "client_kb", "domain_kb"] as const;
const DEFAULT_ANALYTICS_TOOL_IDS = ["google-analytics", "yandex-metrika", "datalens"] as const;

export interface PrepareAnalyticsInvocationInput {
  readonly store: MemoryStore;
  readonly registry: ToolRegistry;
  readonly credentials: CredentialStore;
  readonly catalog: ModelCatalog;
  readonly template: RoleTemplate;
  readonly context: Readonly<InvocationContext>;
  readonly taskDescription: string;
  readonly clientFactKeys: readonly string[];
  // Domain KB keys for the prompt's "Экспертные знания" block — e.g.
  // @ama/knowledge-base's YANDEX_DIRECT_REACH_CAMPAIGN_ANALYTICS_FACT_KEYS
  // when reporting on a reach/media campaign, so the report correctly
  // reads Lift studies, viewability and frequency instead of judging a
  // CPM campaign by CPA/ROI.
  readonly domainFactKeys?: readonly string[];
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
  // Client ad-account reporting foundation's client.id — see
  // AnalyticsTaskPayload.clientId. When supplied, "client-context" is
  // added to this invocation's tool scope automatically so the handler is
  // actually allowed to call it (Tool Integration §2's enforced boundary).
  readonly clientId?: string;
}

export function prepareAnalyticsInvocation(input: PrepareAnalyticsInvocationInput) {
  const analyticsToolIds = input.analyticsToolIds ?? DEFAULT_ANALYTICS_TOOL_IDS;
  const toolIds = input.clientId ? [...analyticsToolIds, "client-context"] : [...analyticsToolIds];
  return prepareAgentInvocation<AnalyticsTaskPayload>({
    store: input.store,
    registry: input.registry,
    credentials: input.credentials,
    catalog: input.catalog,
    template: input.template,
    context: input.context,
    taskDescription: input.taskDescription,
    clientFactKeys: input.clientFactKeys,
    domainFactKeys: input.domainFactKeys ?? [],
    projectContextKeys: input.projectContextKeys,
    memoryLevels: [...MEMORY_LEVELS],
    toolIds,
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
      clientId: input.clientId,
    }),
  });
}
