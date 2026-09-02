import type { InvocationContext } from "@ama/agent-framework";
import type { MemoryStore } from "@ama/memory";
import type { RoleTemplate } from "@ama/prompt-architecture";
import type { CredentialStore, ToolInvoker, ToolRegistry } from "@ama/tools";
import type { ModelCatalog, TaskComplexity } from "@ama/cost-router";
import { prepareAgentInvocation } from "@ama/workflow-engine";
import type { PpcApplyPayload, PpcRecommendPayload, PpcSetupPayload, PpcTaskPayload, PpcVerifyPayload } from "./ppc-agent.ts";

const MEMORY_LEVELS = ["task", "project", "client_kb", "domain_kb"] as const;

export interface PreparePpcInvocationInput {
  readonly store: MemoryStore;
  readonly registry: ToolRegistry;
  readonly credentials: CredentialStore;
  readonly catalog: ModelCatalog;
  readonly template: RoleTemplate;
  readonly context: Readonly<InvocationContext>;
  readonly taskDescription: string;
  readonly clientFactKeys: readonly string[];
  // Domain KB keys to pull into the prompt (Prompt Architecture §1's
  // "Экспертные знания" block) — e.g. @ama/knowledge-base's
  // YANDEX_DIRECT_REACH_CAMPAIGN_FACT_KEYS when the task involves a
  // yandex-direct reach/media campaign. Not defaulted here: which facts
  // are relevant depends on the task (search vs. reach campaign), and
  // that judgment belongs to whoever assembles the task (PM Agent /
  // Workflow Engine), not to this thin dispatch wrapper.
  readonly domainFactKeys?: readonly string[];
  // Project Memory keys of Tasks this one depends on, e.g. Creative
  // Agent's `<taskId>:creative-assets` — same mechanism and same caveat as
  // @ama/agent-ui-designer's projectContextKeys (assemblePrompt only
  // surfaces string-valued entries, so a structured object here doesn't
  // yet appear as prompt text). Optional and defaulted to `[]` so every
  // existing caller keeps working unchanged.
  readonly projectContextKeys?: readonly string[];
  readonly channels: readonly string[];
  readonly complexity: TaskComplexity;
  readonly invokeTool: ToolInvoker;
  readonly googleAdsCustomerId?: string;
  readonly yandexClientLogin?: string;
  readonly metaAdAccountId?: string;
  readonly siteUrl: string;
  readonly regionIds?: readonly number[];
  readonly geoTargetConstants?: readonly string[];
  readonly languageConstants?: readonly string[];
}

// Thin, role-specific wrapper over @ama/workflow-engine's generic
// prepareAgentInvocation — see that module for what this actually does.
// Unchanged since before the 2026-08-30 Track B extension — builds the
// "setup" action's payload; the three new actions get their own prepare*
// functions below rather than one function branching on action, since
// their required inputs (clientAdAccountId vs. channels/siteUrl) don't
// overlap enough to share one input interface cleanly.
export function preparePpcInvocation(input: PreparePpcInvocationInput) {
  return prepareAgentInvocation<PpcTaskPayload>({
    store: input.store,
    registry: input.registry,
    credentials: input.credentials,
    catalog: input.catalog,
    template: input.template,
    context: input.context,
    taskDescription: input.taskDescription,
    clientFactKeys: input.clientFactKeys,
    domainFactKeys: input.domainFactKeys ?? [],
    projectContextKeys: input.projectContextKeys ?? [],
    memoryLevels: [...MEMORY_LEVELS],
    toolIds: input.channels,
    complexity: input.complexity,
    invokeTool: input.invokeTool,
    buildPayload: (prompt, modelId): PpcSetupPayload => ({
      action: "setup",
      prompt,
      modelId,
      channels: input.channels,
      googleAdsCustomerId: input.googleAdsCustomerId,
      yandexClientLogin: input.yandexClientLogin,
      metaAdAccountId: input.metaAdAccountId,
      siteUrl: input.siteUrl,
      regionIds: input.regionIds,
      geoTargetConstants: input.geoTargetConstants,
      languageConstants: input.languageConstants,
    }),
  });
}

const OPTIMIZE_TOOL_IDS = ["google-ads-optimize", "yandex-direct-optimize", "client-context", "campaign-changes"] as const;

export interface PreparePpcRecommendInvocationInput {
  readonly store: MemoryStore;
  readonly registry: ToolRegistry;
  readonly credentials: CredentialStore;
  readonly catalog: ModelCatalog;
  readonly template: RoleTemplate;
  readonly context: Readonly<InvocationContext>;
  readonly taskDescription: string;
  readonly clientAdAccountId: string;
  readonly platform: "google-ads" | "yandex-direct";
  readonly externalAccountId: string;
  readonly conversionActionIdsOrGoalIds?: readonly string[];
  readonly complexity: TaskComplexity;
  readonly invokeTool: ToolInvoker;
}

export function preparePpcRecommendInvocation(input: PreparePpcRecommendInvocationInput) {
  return prepareAgentInvocation<PpcTaskPayload>({
    store: input.store,
    registry: input.registry,
    credentials: input.credentials,
    catalog: input.catalog,
    template: input.template,
    context: input.context,
    taskDescription: input.taskDescription,
    clientFactKeys: [],
    memoryLevels: [...MEMORY_LEVELS],
    toolIds: [...OPTIMIZE_TOOL_IDS],
    complexity: input.complexity,
    invokeTool: input.invokeTool,
    buildPayload: (prompt, modelId): PpcRecommendPayload => ({
      action: "recommend",
      prompt,
      modelId,
      clientAdAccountId: input.clientAdAccountId,
      platform: input.platform,
      externalAccountId: input.externalAccountId,
      conversionActionIdsOrGoalIds: input.conversionActionIdsOrGoalIds,
    }),
  });
}

export interface PreparePpcApplyInvocationInput {
  readonly store: MemoryStore;
  readonly registry: ToolRegistry;
  readonly credentials: CredentialStore;
  readonly catalog: ModelCatalog;
  readonly template: RoleTemplate;
  readonly context: Readonly<InvocationContext>;
  readonly taskDescription: string;
  readonly changeLogId: string;
  readonly platform: "google-ads" | "yandex-direct";
  readonly externalAccountId: string;
  readonly complexity: TaskComplexity;
  readonly invokeTool: ToolInvoker;
}

export function preparePpcApplyInvocation(input: PreparePpcApplyInvocationInput) {
  return prepareAgentInvocation<PpcTaskPayload>({
    store: input.store,
    registry: input.registry,
    credentials: input.credentials,
    catalog: input.catalog,
    template: input.template,
    context: input.context,
    taskDescription: input.taskDescription,
    clientFactKeys: [],
    memoryLevels: [...MEMORY_LEVELS],
    toolIds: [...OPTIMIZE_TOOL_IDS],
    complexity: input.complexity,
    invokeTool: input.invokeTool,
    buildPayload: (): PpcApplyPayload => ({
      action: "apply",
      changeLogId: input.changeLogId,
      platform: input.platform,
      externalAccountId: input.externalAccountId,
    }),
  });
}

export interface PreparePpcVerifyInvocationInput {
  readonly store: MemoryStore;
  readonly registry: ToolRegistry;
  readonly credentials: CredentialStore;
  readonly catalog: ModelCatalog;
  readonly template: RoleTemplate;
  readonly context: Readonly<InvocationContext>;
  readonly taskDescription: string;
  readonly changeLogId: string;
  readonly platform: "google-ads" | "yandex-direct";
  readonly externalAccountId: string;
  readonly complexity: TaskComplexity;
  readonly invokeTool: ToolInvoker;
}

export function preparePpcVerifyInvocation(input: PreparePpcVerifyInvocationInput) {
  return prepareAgentInvocation<PpcTaskPayload>({
    store: input.store,
    registry: input.registry,
    credentials: input.credentials,
    catalog: input.catalog,
    template: input.template,
    context: input.context,
    taskDescription: input.taskDescription,
    clientFactKeys: [],
    memoryLevels: [...MEMORY_LEVELS],
    toolIds: [...OPTIMIZE_TOOL_IDS],
    complexity: input.complexity,
    invokeTool: input.invokeTool,
    buildPayload: (): PpcVerifyPayload => ({
      action: "verify",
      changeLogId: input.changeLogId,
      platform: input.platform,
      externalAccountId: input.externalAccountId,
    }),
  });
}
