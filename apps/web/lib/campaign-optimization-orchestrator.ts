import { asProjectId, asRoleId, asTaskId, createInvocationContext } from "@ama/agent-framework";
import {
  createPpcAgent,
  preparePpcApplyInvocation,
  preparePpcRecommendInvocation,
  preparePpcTrendAlertsInvocation,
  preparePpcVerifyInvocation,
  type PpcApplyResult,
  type PpcRecommendResult,
  type PpcTrendAlertsResult,
  type PpcVerifyResult,
} from "@ama/agent-ppc";
import { recordObservation } from "@ama/learning";
import { OWNER_TENANT_ID, REFLECTION_ACTOR, getSingletons } from "./singletons.ts";
import { isAnthropicConfigured } from "./anthropic.ts";
import { realToolInvoker } from "./real-tools.ts";
import { realPpc, realPpcRecommend } from "./real-models.ts";
import { getCampaignChange } from "./tools/campaign-changes-store.ts";

// Track B (campaign optimization) orchestration — unlike Track A's
// prospecting-orchestrator.ts, these are single-node operations (recommend
// on a client_ad_account, apply one already-approved change, verify one
// already-applied change), not a multi-step graph — no buildGraph() needed,
// just a direct prepareXInvocation + createPpcAgent().invoke() per action.
// All three go through the SAME extended ppc-agent (see
// packages/agents/ppc/src/ppc-agent.ts) — this file only supplies the
// per-action inputs and picks real vs. fallback model callers.

const USE_REAL_MODELS = isAnthropicConfigured();

const fakePpcRecommend: Parameters<typeof createPpcAgent>[1] = async () => ({
  proposedChanges: [],
  decisionSummary: "Нет ANTHROPIC_API_KEY — рекомендации не сформированы.",
});

function ctx(clientAdAccountId: string, taskId: string) {
  return createInvocationContext({
    tenantId: OWNER_TENANT_ID,
    projectId: asProjectId(clientAdAccountId),
    taskId: asTaskId(taskId),
    roleId: asRoleId("ppc"),
    executionTier: "standard",
    approvalLevel: "strategy-gate",
  });
}

export interface RunRecommendInput {
  readonly clientAdAccountId: string;
  readonly platform: "google-ads" | "yandex-direct";
  readonly externalAccountId: string;
  readonly conversionActionIdsOrGoalIds?: readonly string[];
}

export async function runRecommend(input: RunRecommendInput): Promise<PpcRecommendResult> {
  const { store, registry, credentials, catalog } = getSingletons();
  const { agentInput } = preparePpcRecommendInvocation({
    store, registry, credentials, catalog,
    template: { roleId: asRoleId("ppc"), version: 1, purpose: "PPC — recommend", responsibility: "Campaign optimization recommendations" },
    context: ctx(input.clientAdAccountId, `recommend-${Date.now()}`),
    taskDescription: "Проанализировать эффективность живых кампаний и предложить изменения.",
    clientAdAccountId: input.clientAdAccountId,
    platform: input.platform,
    externalAccountId: input.externalAccountId,
    conversionActionIdsOrGoalIds: input.conversionActionIdsOrGoalIds,
    complexity: "standard",
    invokeTool: realToolInvoker,
  });
  const output = await createPpcAgent(realPpc, USE_REAL_MODELS ? realPpcRecommend : fakePpcRecommend).invoke(agentInput);
  if (output.status !== "success") {
    throw new Error(`Recommend failed: ${output.status === "failed" ? output.error.message : output.reason}`);
  }
  return output.result as PpcRecommendResult;
}

export interface RunApplyInput {
  readonly changeLogId: string;
  readonly platform: "google-ads" | "yandex-direct";
  readonly externalAccountId: string;
}

export async function runApply(input: RunApplyInput): Promise<PpcApplyResult> {
  const { store, registry, credentials, catalog } = getSingletons();
  const { agentInput } = preparePpcApplyInvocation({
    store, registry, credentials, catalog,
    template: { roleId: asRoleId("ppc"), version: 1, purpose: "PPC — apply", responsibility: "Apply an approved campaign change" },
    context: ctx(input.changeLogId, `apply-${Date.now()}`),
    taskDescription: "Применить одобренное изменение через API.",
    changeLogId: input.changeLogId,
    platform: input.platform,
    externalAccountId: input.externalAccountId,
    complexity: "routine",
    invokeTool: realToolInvoker,
  });
  const output = await createPpcAgent(realPpc).invoke(agentInput);
  if (output.status !== "success") {
    throw new Error(`Apply failed: ${output.status === "failed" ? output.error.message : output.reason}`);
  }
  return output.result as PpcApplyResult;
}

export interface RunVerifyInput {
  readonly changeLogId: string;
  readonly platform: "google-ads" | "yandex-direct";
  readonly externalAccountId: string;
}

export async function runVerify(input: RunVerifyInput): Promise<PpcVerifyResult> {
  const { store, registry, credentials, catalog } = getSingletons();
  const { agentInput } = preparePpcVerifyInvocation({
    store, registry, credentials, catalog,
    template: { roleId: asRoleId("ppc"), version: 1, purpose: "PPC — verify", responsibility: "Compare actual vs. expected effect" },
    context: ctx(input.changeLogId, `verify-${Date.now()}`),
    taskDescription: "Проверить фактический эффект применённого изменения.",
    changeLogId: input.changeLogId,
    platform: input.platform,
    externalAccountId: input.externalAccountId,
    complexity: "routine",
    invokeTool: realToolInvoker,
  });
  const output = await createPpcAgent(realPpc).invoke(agentInput);
  if (output.status !== "success") {
    throw new Error(`Verify failed: ${output.status === "failed" ? output.error.message : output.reason}`);
  }
  const result = output.result as PpcVerifyResult;

  // First real caller of @ama/learning for Track B (Plan §1.5) — every
  // verify closes the loop on one recommend->apply cycle, exactly the
  // "did this prediction pan out" signal the package was designed for.
  // Outcome is deliberately always "success" here (a simplification, not
  // hidden): judging whether the actual effect was GOOD vs BAD requires
  // comparing before/after metrics numerically, which is future work — the
  // conclusion text itself (actualEffect) still carries the real
  // before/after comparison for a human or a later pass to read.
  try {
    const change = await getCampaignChange(input.changeLogId);
    const { store } = getSingletons();
    recordObservation(store, REFLECTION_ACTOR, OWNER_TENANT_ID, `ppc-verify-${input.changeLogId}-${Date.now()}`, {
      situation: `changeType=${change.changeType}; expectedEffect=${change.expectedEffect ?? "n/a"}`,
      outcome: "success",
      conclusion: result.actualEffect,
      roleId: asRoleId("ppc"),
      groupKey: change.changeType,
    });
  } catch {
    // Best-effort — a failure recording a lesson must never fail the
    // verify Task itself, which already succeeded above.
  }

  return result;
}

export interface RunTrendAlertsInput {
  readonly clientAdAccountId: string;
  readonly clientId: string;
  readonly platform: "google-ads" | "yandex-direct";
  readonly minWeeks?: number;
  readonly minTotalIncreasePct?: number;
  readonly maxDipSteps?: number;
}

// Weekly sustained-CPA-degradation detection (2026-09-03,
// docs/03-architecture/campaign-weekly-trends.md) — deterministic, no model
// call (same "mechanical, not judgment" shape as runApply/runVerify above),
// called from the weekly cron (apps/web/app/api/cron/detect-trend-alerts).
export async function runTrendAlerts(input: RunTrendAlertsInput): Promise<PpcTrendAlertsResult> {
  const { store, registry, credentials, catalog } = getSingletons();
  const { agentInput } = preparePpcTrendAlertsInvocation({
    store, registry, credentials, catalog,
    template: { roleId: asRoleId("ppc"), version: 1, purpose: "PPC — trend-alerts", responsibility: "Detect sustained CPA degradation and log it for review" },
    context: ctx(input.clientAdAccountId, `trend-alerts-${Date.now()}`),
    taskDescription: "Найти устойчивый рост CPA по кампаниям за последние недели и записать как предложенные изменения.",
    clientAdAccountId: input.clientAdAccountId,
    clientId: input.clientId,
    platform: input.platform,
    minWeeks: input.minWeeks,
    minTotalIncreasePct: input.minTotalIncreasePct,
    maxDipSteps: input.maxDipSteps,
    complexity: "routine",
    invokeTool: realToolInvoker,
  });
  const output = await createPpcAgent(realPpc).invoke(agentInput);
  if (output.status !== "success") {
    throw new Error(`Trend alerts failed: ${output.status === "failed" ? output.error.message : output.reason}`);
  }
  return output.result as PpcTrendAlertsResult;
}
