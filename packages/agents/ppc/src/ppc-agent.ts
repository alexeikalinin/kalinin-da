import { defineAgent, type AgentError, type AgentInput, type AgentOutput } from "@ama/agent-framework";
import type { PromptBlocks } from "@ama/prompt-architecture";

// Agent Framework §3's own worked example, now actually implemented:
// "настроить рекламные кампании в Google Ads/Яндекс.Директ/VK Ads."
//
// 2026-08-30 — Track B / campaign-optimization: extended (by the Owner's
// explicit choice, not as a new agent role) to also recommend, apply, and
// verify optimizations on a client's LIVE campaigns. Responsibility is now
// "the full PPC campaign lifecycle" — still not media budget planning
// (Media Buyer Agent) or ad copy content (Copywriter Agent). Generalizes
// .claude/agents/medavenue-analyst.md's read-only recommend logic into a
// real, multi-tenant capability that can also apply human-approved
// changes — see docs/03-architecture/campaign-optimization.md.
// One ad group's targeting within a direction's campaign. `descriptions`
// doubles as the Yandex text ad's Text (descriptions[0], trimmed to 81
// chars) so PPC's model produces one ad-copy shape regardless of platform
// — see real-tools.ts's "google-ads"/"yandex-direct" cases for exactly how
// each platform slices it.
export interface PpcAdGroupPlan {
  readonly name: string; // e.g. "Имплантация — цена"
  readonly keywords: readonly string[];
  readonly headlines: readonly string[]; // Google RSA: 3–15, ≤30 chars. Yandex: headlines[0]→Title (≤56), headlines[1]→Title2 (≤30)
  readonly descriptions: readonly string[]; // Google RSA: 2–4, ≤90 chars. Yandex: descriptions[0]→Text (≤81)
}

// One direction's campaign (e.g. "Имплантация" vs "Протезирование") —
// several ad groups by search intent under one campaign, not one flat
// keyword list. 2026-09-02, Track B follow-up: ported from PPC Master
// Tool's real, live-tested campaign scripts (scripts/create_google_gastro.py
// for Google, scripts/draft_campaigns_setup.py for Yandex) after the Owner
// asked why PPC's own campaigns had no concept of ad group / campaign
// structure at all — see docs/07-planning/backlog.md #31/#30's follow-up.
// Yandex Direct Search/Network bidding strategy — mirrors
// yandex-direct.ts's YandexSearchBiddingStrategy/YandexNetworkBiddingStrategy
// field-for-field (not imported: packages/agents/ppc can't depend on
// apps/web's tool modules — same "own plain shape, real-tools.ts maps it
// onto the tool's real type" pattern PpcAdGroupPlan/PpcDirectionCampaignPlan
// already use). `type` isn't narrowed to a literal union here on purpose —
// yandex-direct.ts is the single source of truth for which values are
// valid and throws a clear error on an unrecognized one; duplicating that
// union here would just be one more place it could drift out of sync.
export interface PpcYandexBiddingStrategy {
  readonly type: string;
  readonly weeklySpendLimitMicros?: number;
  readonly bidCeilingMicros?: number;
  readonly averageCpaMicros?: number;
  readonly averageCpcMicros?: number;
  readonly averageRoiCoef?: number;
  readonly reserveReturnPercent?: number;
  readonly goalId?: number;
  readonly payForConversionEnabled?: boolean;
}

export interface PpcDirectionCampaignPlan {
  readonly name: string;
  readonly budgetShare: number; // 0..1, share of this channel's total budget
  readonly adGroups: readonly PpcAdGroupPlan[];
  // Yandex-only, 2026-09-02 — lets a direction pick e.g. AVERAGE_CPA instead
  // of the HIGHEST_POSITION default (see docs/05-operations's Track B
  // follow-up: PPC Master Tool's draft_campaigns_setup.py supported both
  // "search_only" and "network_only" TextCampaign variants, this file only
  // ever hardcoded one). Ignored by google-ads.ts's builder.
  readonly yandexSearchStrategy?: PpcYandexBiddingStrategy;
  readonly yandexNetworkStrategy?: PpcYandexBiddingStrategy;
}

export interface PpcSetupResult {
  readonly action?: "setup";
  readonly budgetSplit: Readonly<Record<string, number>>; // channel -> share, e.g. { "google-ads": 0.6, "vk-ads": 0.4 }
  // Multi-campaign / multi-ad-group structure, keyed by channel — the real
  // shape a PPC specialist would propose (several directions, each with
  // several ad groups by intent). When present for a channel, real-tools.ts
  // builds one real campaign per PpcDirectionCampaignPlan via
  // buildMultiGroupSearchCampaign instead of the flat single-ad-group path
  // below.
  readonly campaigns?: Readonly<Record<string, readonly PpcDirectionCampaignPlan[]>>;
  // Legacy flat shape — still the only path for vk-ads/meta-ads (neither
  // has a multi-group builder yet) and kept as the fallback for any
  // channel `campaigns` doesn't cover.
  readonly keywords?: Readonly<Record<string, readonly string[]>>;
  readonly adCopy?: Readonly<Record<string, { readonly headlines: readonly string[]; readonly descriptions: readonly string[] }>>;
  readonly negativeKeywords?: Readonly<Record<string, readonly string[]>>;
  readonly sitelinks?: Readonly<Record<string, readonly { readonly text: string; readonly finalUrl: string }[]>>;
  readonly callouts?: Readonly<Record<string, readonly string[]>>;
}

export interface ProposedChange {
  readonly campaignId?: string;
  readonly campaignName?: string;
  readonly changeType: string; // e.g. 'budget_changed', 'negative_added', 'bid_adjusted', 'status_changed'
  readonly changeDescription: string;
  readonly expectedEffect?: string;
  readonly verdict?: "scale" | "optimize" | "cut" | "pause" | "watch"; // medavenue-analyst.md's classification, generalized
}

export interface PpcRecommendResult {
  readonly action: "recommend";
  readonly proposedChanges: readonly ProposedChange[];
  readonly changeLogIds: readonly string[];
}

export interface PpcApplyResult {
  readonly action: "apply";
  readonly applyStatus: "applied" | "apply_failed";
  readonly applyResult?: unknown;
}

export interface PpcVerifyResult {
  readonly action: "verify";
  readonly actualEffect: string;
  readonly afterMetrics: Readonly<Record<string, unknown>>;
}

export type PpcResult = PpcSetupResult | PpcRecommendResult | PpcApplyResult | PpcVerifyResult;

export interface PpcSetupPayload {
  // Optional and defaulting to "setup" (not required) so every existing
  // caller/test that never set `action` at all keeps working unchanged —
  // this is the one variant of the union that predates the 2026-08-30
  // extension.
  readonly action?: "setup";
  readonly prompt: PromptBlocks;
  readonly modelId: string;
  readonly channels: readonly string[];
  readonly googleAdsCustomerId?: string; // the client's own Ads account, if known
  readonly yandexClientLogin?: string; // the client's own Yandex Direct login, if known
  readonly metaAdAccountId?: string; // the client's own Meta ad account (format `act_<id>`), if known
  readonly siteUrl: string; // needed by vk-ads to register the ad-object URL (see tools/vk-ads.ts)
  // Region, 2026-09-02 — previously dead plumbing (backlog #31): google-ads.ts
  // could already accept geoTargetConstants/languageConstants, but nothing
  // upstream of it ever set them. regionIds is Yandex's own numeric geo
  // system (ad-group-level RegionIds — same ids Wordstat uses, e.g. 157
  // Minsk + 10996 Minsk region); geoTargetConstants/languageConstants are
  // Google's resource-name form (e.g. "geoTargetConstants/1001493" for
  // Minsk, "languageConstants/1031" for Russian).
  readonly regionIds?: readonly number[];
  readonly geoTargetConstants?: readonly string[];
  readonly languageConstants?: readonly string[];
  // Yandex-only, 2026-09-02 — selects one of Direct API v5's five campaign
  // types for the flat/no-campaignPlans fallback path (see yandex-direct.ts's
  // YandexCampaignType). Defaults to TEXT_CAMPAIGN when unset, matching prior
  // behavior. yandexCampaignTypeFields is a raw passthrough required for
  // CPM_BANNER_CAMPAIGN/SMART_CAMPAIGN — their BiddingStrategy shape isn't
  // modeled in this codebase yet.
  readonly yandexCampaignType?: "TEXT_CAMPAIGN" | "DYNAMIC_TEXT_CAMPAIGN" | "MOBILE_APP_CAMPAIGN" | "CPM_BANNER_CAMPAIGN" | "SMART_CAMPAIGN";
  readonly yandexCampaignTypeFields?: Record<string, unknown>;
}

export interface PpcRecommendPayload {
  readonly action: "recommend";
  readonly prompt: PromptBlocks;
  readonly modelId: string;
  readonly clientAdAccountId: string;
  readonly platform: "google-ads" | "yandex-direct";
  readonly externalAccountId: string; // Google customerId or Yandex clientLogin
  readonly conversionActionIdsOrGoalIds?: readonly string[];
}

export interface PpcApplyPayload {
  readonly action: "apply";
  readonly changeLogId: string;
  readonly platform: "google-ads" | "yandex-direct";
  readonly externalAccountId: string;
}

export interface PpcVerifyPayload {
  readonly action: "verify";
  readonly changeLogId: string;
  readonly platform: "google-ads" | "yandex-direct";
  readonly externalAccountId: string;
}

export type PpcTaskPayload = PpcSetupPayload | PpcRecommendPayload | PpcApplyPayload | PpcVerifyPayload;

// The actual LLM calls are injected. This package wires the contract
// together; it does not itself hold API credentials or call a real
// provider — none exist in this environment. See README.
export type PpcSetupModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
) => Promise<{ readonly result: PpcSetupResult; readonly decisionSummary: string }>;

// campaignData carries whatever the "recommend" handler already pulled via
// tools (live campaign list/report, weekly spend limit, keyword bids, prior
// changes) — folded into the prompt by the real caller (real-models.ts),
// same "tool output before model call" shape as research-agent.ts.
export type PpcRecommendModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
  campaignData: unknown,
) => Promise<{ readonly proposedChanges: readonly ProposedChange[]; readonly decisionSummary: string }>;

export function createPpcAgent(callSetupModel: PpcSetupModelCaller, callRecommendModel?: PpcRecommendModelCaller) {
  return defineAgent<PpcTaskPayload, PpcResult>({
    roleId: "ppc",
    displayName: "PPC Agent",
    purpose: "Настроить, контролировать и оптимизировать рекламные кампании клиента.",
    responsibility:
      "Только PPC-кампании (создание, рекомендации, применение одобренных изменений, проверка эффекта) — не медиапланирование бюджета (Media Buyer Agent) и не тексты объявлений (Copywriter Agent).",
    completionCriteria:
      "setup: результат проходит проверку QA. recommend: изменения записаны в campaign_changes_log со status='proposed'. apply: применяется только status='approved', результат залогирован. verify: actual_effect/after_metrics записаны для последующего анализа.",
    memoryLevels: ["task", "project", "client_kb", "domain_kb"],
    toolIds: ["google-ads", "vk-ads", "yandex-direct", "meta-ads", "google-ads-optimize", "yandex-direct-optimize", "client-context", "campaign-changes"],

    async handler(input: AgentInput<PpcTaskPayload>): Promise<AgentOutput<PpcResult>> {
      const payload = input.task.payload;
      const action = payload.action ?? "setup";

      if (action === "setup") {
        return handleSetup(input, payload as PpcSetupPayload, callSetupModel);
      }
      if (action === "recommend") {
        if (!callRecommendModel) {
          return { status: "failed", error: { code: "NO_RECOMMEND_MODEL", message: "No recommend model caller configured.", retryable: false } };
        }
        return handleRecommend(input, payload as PpcRecommendPayload, callRecommendModel);
      }
      if (action === "apply") {
        return handleApply(input, payload as PpcApplyPayload);
      }
      return handleVerify(input, payload as PpcVerifyPayload);
    },
  });
}

async function handleSetup(
  input: AgentInput<PpcTaskPayload>,
  payload: PpcSetupPayload,
  callModel: PpcSetupModelCaller,
): Promise<AgentOutput<PpcResult>> {
  let outcome: Awaited<ReturnType<PpcSetupModelCaller>>;
  try {
    outcome = await callModel(payload.prompt, payload.modelId);
  } catch (error) {
    return { status: "failed", error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true } };
  }

  for (const channel of payload.channels) {
    try {
      await input.tools.invoke(channel, {
        budgetShare: outcome.result.budgetSplit[channel] ?? 0,
        googleAdsCustomerId: payload.googleAdsCustomerId,
        yandexClientLogin: payload.yandexClientLogin,
        metaAdAccountId: payload.metaAdAccountId,
        siteUrl: payload.siteUrl,
        // Preferred path: several campaigns (one per direction), each with
        // several ad groups by intent. Falls back to the flat single-group
        // fields below when this channel has none (vk-ads/meta-ads today).
        campaignPlans: outcome.result.campaigns?.[channel],
        regionIds: payload.regionIds,
        geoTargetConstants: payload.geoTargetConstants,
        languageConstants: payload.languageConstants,
        yandexCampaignType: payload.yandexCampaignType,
        yandexCampaignTypeFields: payload.yandexCampaignTypeFields,
        keywords: outcome.result.keywords?.[channel],
        adCopy: outcome.result.adCopy?.[channel],
        negativeKeywords: outcome.result.negativeKeywords?.[channel],
        sitelinks: outcome.result.sitelinks?.[channel],
        callouts: outcome.result.callouts?.[channel],
      });
    } catch (error) {
      return { status: "failed", error: error as AgentError };
    }
  }

  await input.memory.write("task", "campaign-summary", outcome.result);

  return { status: "success", result: outcome.result, decisions: [{ summary: outcome.decisionSummary }] };
}

function optimizeToolId(platform: "google-ads" | "yandex-direct"): string {
  return platform === "google-ads" ? "google-ads-optimize" : "yandex-direct-optimize";
}

async function handleRecommend(
  input: AgentInput<PpcTaskPayload>,
  payload: PpcRecommendPayload,
  callModel: PpcRecommendModelCaller,
): Promise<AgentOutput<PpcResult>> {
  const toolId = optimizeToolId(payload.platform);
  let campaignData: unknown;
  let priorChanges: unknown;
  try {
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const [campaigns, report] = await Promise.all([
      input.tools.invoke(toolId, { action: "listCampaigns", customerId: payload.externalAccountId, clientLogin: payload.externalAccountId }),
      input.tools.invoke(toolId, {
        action: "getCampaignReport",
        customerId: payload.externalAccountId,
        clientLogin: payload.externalAccountId,
        startDate,
        endDate,
        conversionActionIds: payload.conversionActionIdsOrGoalIds ?? [],
        goalIds: payload.conversionActionIdsOrGoalIds ?? [],
      }),
    ]);
    campaignData = { campaigns, report };
    priorChanges = await input.tools.invoke("campaign-changes", {
      action: "listCampaignChanges",
      clientAdAccountId: payload.clientAdAccountId,
      limit: 10,
    });
  } catch (error) {
    return { status: "failed", error: error as AgentError };
  }

  let outcome: Awaited<ReturnType<PpcRecommendModelCaller>>;
  try {
    outcome = await callModel(payload.prompt, payload.modelId, { campaignData, priorChanges });
  } catch (error) {
    return { status: "failed", error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true } };
  }

  const changeLogIds: string[] = [];
  try {
    for (const change of outcome.proposedChanges) {
      const created = (await input.tools.invoke("campaign-changes", {
        action: "proposeCampaignChange",
        clientAdAccountId: payload.clientAdAccountId,
        campaignId: change.campaignId,
        campaignName: change.campaignName,
        changeType: change.changeType,
        changeDescription: change.changeDescription,
        expectedEffect: change.expectedEffect,
        beforeMetrics: { report: campaignData },
        proposedByRunId: input.task.context.taskId,
        createdBy: "agent:ppc",
      })) as { id: string };
      changeLogIds.push(created.id);
    }
  } catch (error) {
    return { status: "failed", error: error as AgentError };
  }

  await input.memory.write("task", "recommended-changes", { proposedChanges: outcome.proposedChanges, changeLogIds });

  return {
    status: "success",
    result: { action: "recommend", proposedChanges: outcome.proposedChanges, changeLogIds },
    decisions: [{ summary: outcome.decisionSummary }],
  };
}

async function handleApply(input: AgentInput<PpcTaskPayload>, payload: PpcApplyPayload): Promise<AgentOutput<PpcResult>> {
  let change: { readonly status: string; readonly changeType: string; readonly campaignId: string | null; readonly changeDescription: string };
  try {
    change = (await input.tools.invoke("campaign-changes", { action: "getCampaignChange", id: payload.changeLogId })) as typeof change;
  } catch (error) {
    return { status: "failed", error: error as AgentError };
  }

  // Never applies anything not already human-approved — enforced here,
  // defensively, in addition to whatever gate the approval UI itself
  // provides (Plan §3: "никогда не применяет без одобрения").
  if (change.status !== "approved") {
    return {
      status: "failed",
      error: {
        code: "NOT_APPROVED",
        message: `campaign_changes_log row ${payload.changeLogId} has status "${change.status}", not "approved" — refusing to apply.`,
        retryable: false,
      },
    };
  }

  const toolId = optimizeToolId(payload.platform);
  let applyResult: unknown;
  try {
    applyResult = await input.tools.invoke(toolId, {
      action: mapChangeTypeToOptimizeAction(change.changeType),
      customerId: payload.externalAccountId,
      clientLogin: payload.externalAccountId,
      campaignId: change.campaignId,
      campaignResourceName: change.campaignId,
      ...parseChangeDescriptionParams(change.changeDescription),
    });
  } catch (error) {
    await input.tools.invoke("campaign-changes", {
      action: "updateCampaignChangeStatus",
      id: payload.changeLogId,
      status: "apply_failed",
      applyResult: { error: error instanceof Error ? error.message : String(error) },
    });
    // Never auto-retried — a failed apply against a live account needs a
    // human to see why before anything tries again (Plan §3).
    return { status: "failed", error: error as AgentError };
  }

  await input.tools.invoke("campaign-changes", {
    action: "updateCampaignChangeStatus",
    id: payload.changeLogId,
    status: "applied",
    applyResult,
  });

  await input.memory.write("task", "applied-change", { changeLogId: payload.changeLogId, applyResult });

  return {
    status: "success",
    result: { action: "apply", applyStatus: "applied", applyResult },
    decisions: [{ summary: `Изменение ${payload.changeLogId} применено.` }],
  };
}

// change_type -> optimize toolId action + which change_description fields
// map to which write function's params. change_description is free text
// today (0007's stated limitation) — a structured params blob would be
// cleaner, but that's a schema change beyond this pass's scope; parsing a
// small fixed set of "key: value" lines out of change_description is the
// pragmatic bridge until change_type-specific structured columns exist.
function mapChangeTypeToOptimizeAction(changeType: string): string {
  switch (changeType) {
    case "budget_changed":
      return "adjustCampaignBudget";
    case "weekly_spend_limit_changed":
      return "adjustWeeklySpendLimit";
    case "negative_added":
      return "addNegativeKeywords";
    case "bid_adjusted":
      return "adjustBid";
    case "status_changed":
      return "setStatus";
    default:
      throw new Error(`Unknown campaign_changes_log change_type "${changeType}" — no optimize action mapped.`);
  }
}

function parseChangeDescriptionParams(changeDescription: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const line of changeDescription.split("\n")) {
    const match = /^([a-zA-Z]+):\s*(.+)$/.exec(line.trim());
    if (!match) continue;
    const [, key, value] = match;
    params[key] = /^-?\d+$/.test(value) ? Number(value) : value;
  }
  return params;
}

async function handleVerify(input: AgentInput<PpcTaskPayload>, payload: PpcVerifyPayload): Promise<AgentOutput<PpcResult>> {
  const toolId = optimizeToolId(payload.platform);
  let change: { readonly expectedEffect: string | null; readonly beforeMetrics: unknown; readonly campaignId: string | null };
  let afterReport: unknown;
  try {
    change = (await input.tools.invoke("campaign-changes", { action: "getCampaignChange", id: payload.changeLogId })) as typeof change;
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    afterReport = await input.tools.invoke(toolId, {
      action: "getCampaignReport",
      customerId: payload.externalAccountId,
      clientLogin: payload.externalAccountId,
      startDate,
      endDate,
      conversionActionIds: [],
      goalIds: [],
    });
  } catch (error) {
    return { status: "failed", error: error as AgentError };
  }

  // Deterministic comparison, not a model call — this role's "verify" step
  // is a factual before/after readback, same "mechanical, not judgment"
  // stance as compliance-checker; packages/learning's recordObservation
  // (wired separately, see task 14) is what turns this into a pattern
  // later, not a per-call LLM narrative here.
  const afterMetrics = { report: afterReport } as Record<string, unknown>;
  const actualEffect = `Проверено ${new Date().toISOString().slice(0, 10)}. Ожидалось: ${change.expectedEffect ?? "не указано"}. Метрики после изменения приложены (after_metrics).`;

  try {
    await input.tools.invoke("campaign-changes", { action: "recordVerification", id: payload.changeLogId, actualEffect, afterMetrics });
  } catch (error) {
    return { status: "failed", error: error as AgentError };
  }

  await input.memory.write("task", "verification", { changeLogId: payload.changeLogId, actualEffect, afterMetrics });

  return {
    status: "success",
    result: { action: "verify", actualEffect, afterMetrics },
    decisions: [{ summary: actualEffect }],
  };
}
