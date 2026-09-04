import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
} from "@ama/agent-framework";
import {
  computeDemandForecast,
  createPpcAgent,
  type PpcApplyResult,
  type PpcRecommendModelCaller,
  type PpcRecommendResult,
  type PpcSetupModelCaller,
  type PpcSetupResult,
  type PpcTrendAlertsResult,
  type PpcVerifyResult,
} from "./ppc-agent.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("task-1"),
    roleId: asRoleId("ppc"),
    executionTier: "standard",
    approvalLevel: "strategy-gate",
  });
}

const emptyPrompt = {
  role: "",
  task: "",
  clientFacts: [],
  domainKnowledge: [],
  pastExperience: [],
  projectContext: [],
  constraints: "",
};

test("a successful call configures every requested channel and records the decision", async () => {
  const invoked: string[] = [];
  const writes: Array<[string, string, unknown]> = [];

  const callModel: PpcSetupModelCaller = async () => ({
    result: { budgetSplit: { "google-ads": 0.6, "vk-ads": 0.4 } },
    decisionSummary: "Бюджет распределён 60/40 между Google Ads и VK Ads.",
  });

  const agent = createPpcAgent(callModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: { prompt: emptyPrompt, modelId: "claude-sonnet", channels: ["google-ads", "vk-ads"], siteUrl: "https://example.com" },
    },
    memory: {
      read: async () => undefined,
      write: async (level, key, value) => {
        writes.push([level, key, value]);
      },
    },
    tools: {
      invoke: async (toolId) => {
        invoked.push(toolId);
        return "ok";
      },
    },
  });

  assert.equal(output.status, "success");
  assert.deepEqual(invoked.sort(), ["google-ads", "vk-ads"]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.[0], "task");
  if (output.status === "success") {
    assert.match(output.decisions[0]?.summary ?? "", /60\/40/);
  }
});

// 2026-09-03 — real search-volume grounding before the model decides
// keywords/ad copy.

test("keyword-volume is called before the model when a dependency's Project Memory has candidateKeywords", async () => {
  const calls: Array<{ toolId: string; args: unknown }> = [];
  let modelSawVolumeData: unknown;

  const callModel: PpcSetupModelCaller = async (_prompt, _modelId, volumeData) => {
    modelSawVolumeData = volumeData;
    return {
      result: { budgetSplit: { "google-ads": 1 } },
      decisionSummary: "Бюджет — в Google Ads.",
    };
  };

  const agent = createPpcAgent(callModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: {
        prompt: emptyPrompt,
        modelId: "x",
        channels: ["google-ads"],
        siteUrl: "https://example.com",
        projectContextKeys: ["research-task:findings"],
      },
    },
    memory: {
      read: async (_level, key) => (key === "research-task:findings" ? { candidateKeywords: ["купить окна пвх"] } : undefined),
      write: async () => {},
    },
    tools: {
      invoke: async (toolId, args) => {
        calls.push({ toolId, args });
        if (toolId === "keyword-volume") return { google: [{ text: "купить окна пвх", avgMonthlySearches: 1000 }] };
        return "ok";
      },
    },
  });

  assert.equal(output.status, "success");
  const volumeCallIndex = calls.findIndex((c) => c.toolId === "keyword-volume");
  const channelCallIndex = calls.findIndex((c) => c.toolId === "google-ads");
  assert.ok(volumeCallIndex >= 0, "keyword-volume must be called");
  assert.ok(volumeCallIndex < channelCallIndex, "keyword-volume must be called before the channel tool");
  assert.deepEqual((calls[volumeCallIndex]?.args as { seedKeywords: string[] }).seedKeywords, ["купить окна пвх"]);
  assert.deepEqual(modelSawVolumeData, { google: [{ text: "купить окна пвх", avgMonthlySearches: 1000 }] });
});

test("keyword-volume is NOT called when no dependency provides candidateKeywords", async () => {
  const calls: string[] = [];
  const callModel: PpcSetupModelCaller = async () => ({
    result: { budgetSplit: { "google-ads": 1 } },
    decisionSummary: "OK",
  });

  const agent = createPpcAgent(callModel);
  await agent.invoke({
    task: {
      context: context(),
      payload: { prompt: emptyPrompt, modelId: "x", channels: ["google-ads"], siteUrl: "https://example.com" },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: { invoke: async (toolId) => { calls.push(toolId); return "ok"; } },
  });

  assert.ok(!calls.includes("keyword-volume"));
});

test("a keyword-volume failure fails the setup Task instead of silently proceeding without volume data", async () => {
  const callModel: PpcSetupModelCaller = async () => {
    throw new Error("model should not be called — keyword-volume failed first");
  };

  const agent = createPpcAgent(callModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: {
        prompt: emptyPrompt,
        modelId: "x",
        channels: ["google-ads"],
        siteUrl: "https://example.com",
        projectContextKeys: ["research-task:findings"],
      },
    },
    memory: {
      read: async (_level, key) => (key === "research-task:findings" ? { candidateKeywords: ["окна пвх"] } : undefined),
      write: async () => {},
    },
    tools: {
      invoke: async (toolId) => {
        if (toolId === "keyword-volume") throw new Error("both sources unavailable");
        return "ok";
      },
    },
  });

  assert.equal(output.status, "failed");
});

test("computeDemandForecast: deterministic arithmetic from real volume and the model's own CTR/CR estimate", () => {
  const volumeData = {
    google: [
      { text: "купить окна пвх", avgMonthlySearches: 1000 },
      { text: "цена окон пвх", avgMonthlySearches: 500 },
    ],
  };
  const result: PpcSetupResult = {
    budgetSplit: { "google-ads": 1 },
    keywords: { "google-ads": ["купить окна пвх", "цена окон пвх"] },
    ctrCrEstimates: { "google-ads": { ctrEstimate: 0.05, crEstimate: 0.1 } },
  };

  const forecast = computeDemandForecast(volumeData, result);

  assert.ok(forecast);
  const googleAds = forecast?.["google-ads"];
  assert.equal(googleAds?.expectedImpressions, 1500);
  assert.equal(googleAds?.expectedClicks, 75); // 1500 * 0.05
  assert.equal(googleAds?.expectedConversions, 7.5); // 75 * 0.1
});

test("computeDemandForecast: undefined when there's no real volume data to ground the forecast in", () => {
  const result: PpcSetupResult = {
    budgetSplit: { "google-ads": 1 },
    keywords: { "google-ads": ["купить окна пвх"] },
    ctrCrEstimates: { "google-ads": { ctrEstimate: 0.05, crEstimate: 0.1 } },
  };
  assert.equal(computeDemandForecast(undefined, result), undefined);
});

test("a failed model call is reported as a failed Task, not thrown", async () => {
  const callModel: PpcSetupModelCaller = async () => {
    throw new Error("provider timeout");
  };

  const agent = createPpcAgent(callModel);
  const output = await agent.invoke({
    task: { context: context(), payload: { prompt: emptyPrompt, modelId: "x", channels: [], siteUrl: "https://example.com" } },
    memory: { read: async () => undefined, write: async () => {} },
    tools: { invoke: async () => "ok" },
  });

  assert.equal(output.status, "failed");
  if (output.status === "failed") {
    assert.equal(output.error.retryable, true);
  }
});

test("a tool failure is reported as a failed Task", async () => {
  const callModel: PpcSetupModelCaller = async () => ({
    result: { budgetSplit: { "google-ads": 1 } },
    decisionSummary: "All budget to Google Ads.",
  });

  const agent = createPpcAgent(callModel);
  const output = await agent.invoke({
    task: { context: context(), payload: { prompt: emptyPrompt, modelId: "x", channels: ["google-ads"], siteUrl: "https://example.com" } },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async () => {
        throw { code: "TOOL_ERROR", message: "invalid credentials", retryable: false };
      },
    },
  });

  assert.equal(output.status, "failed");
});

// 2026-08-30 — Track B extension. Same createPpcAgent, discriminated by
// payload.action.

const noSetupModel: PpcSetupModelCaller = async () => {
  throw new Error("setup model should not be called for a non-setup action");
};

test("recommend: reads live campaign data + prior changes, then writes proposed changes to campaign-changes", async () => {
  const toolCalls: Array<{ toolId: string; args: unknown }> = [];
  const callRecommendModel: PpcRecommendModelCaller = async () => ({
    proposedChanges: [
      { campaignId: "123", changeType: "budget_changed", changeDescription: "campaignBudgetResourceName: x\nnewAmountMicros: 5000000", expectedEffect: "+10% conversions", verdict: "scale" },
    ],
    decisionSummary: "Кампания 123 недооценена по бюджету — увеличить.",
  });

  const agent = createPpcAgent(noSetupModel, callRecommendModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: { action: "recommend", prompt: emptyPrompt, modelId: "claude-sonnet", clientAdAccountId: "acct-1", platform: "google-ads", externalAccountId: "123-456-7890" },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async (toolId, args) => {
        toolCalls.push({ toolId, args });
        if (toolId === "google-ads-optimize") return { data: "campaign data" };
        if (toolId === "campaign-changes") {
          const a = args as { action: string };
          if (a.action === "listCampaignChanges") return [];
          if (a.action === "proposeCampaignChange") return { id: "change-1" };
        }
        throw new Error(`unexpected call ${toolId}`);
      },
    },
  });

  assert.equal(output.status, "success");
  if (output.status === "success") {
    const result = output.result as PpcRecommendResult;
    assert.deepEqual(result.changeLogIds, ["change-1"]);
  }
  assert.ok(toolCalls.some((c) => c.toolId === "google-ads-optimize" && (c.args as { action: string }).action === "listCampaigns"));
});

test("recommend without a recommend model caller fails cleanly instead of calling the setup model", async () => {
  const agent = createPpcAgent(noSetupModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: { action: "recommend", prompt: emptyPrompt, modelId: "x", clientAdAccountId: "acct-1", platform: "google-ads", externalAccountId: "123" },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: { invoke: async () => ({}) },
  });
  assert.equal(output.status, "failed");
});

test("apply: refuses to apply a change that is not yet approved", async () => {
  const agent = createPpcAgent(noSetupModel);
  const output = await agent.invoke({
    task: { context: context(), payload: { action: "apply", changeLogId: "change-1", platform: "google-ads", externalAccountId: "123" } },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async (toolId, args) => {
        const a = args as { action: string };
        if (toolId === "campaign-changes" && a.action === "getCampaignChange") {
          return { status: "proposed", changeType: "budget_changed", campaignId: "123", changeDescription: "newAmountMicros: 5000000" };
        }
        throw new Error(`should not reach ${toolId}/${a.action} for an unapproved change`);
      },
    },
  });
  assert.equal(output.status, "failed");
});

test("apply: applies an approved change and logs the result, never auto-retrying on failure", async () => {
  const statusUpdates: Array<{ status: string }> = [];
  const agent = createPpcAgent(noSetupModel);
  const output = await agent.invoke({
    task: { context: context(), payload: { action: "apply", changeLogId: "change-1", platform: "google-ads", externalAccountId: "123" } },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async (toolId, args) => {
        const a = args as { action: string; status?: string };
        if (toolId === "campaign-changes" && a.action === "getCampaignChange") {
          return { status: "approved", changeType: "budget_changed", campaignId: "123", changeDescription: "newAmountMicros: 5000000" };
        }
        if (toolId === "google-ads-optimize" && a.action === "adjustCampaignBudget") return { resourceName: "customers/1/campaignBudgets/1" };
        if (toolId === "campaign-changes" && a.action === "updateCampaignChangeStatus") {
          if (a.status) statusUpdates.push({ status: a.status });
          return { ok: true };
        }
        throw new Error(`unexpected call ${toolId}/${a.action}`);
      },
    },
  });

  assert.equal(output.status, "success");
  if (output.status === "success") {
    assert.equal((output.result as PpcApplyResult).applyStatus, "applied");
  }
  assert.deepEqual(statusUpdates, [{ status: "applied" }]);
});

test("verify: reads back fresh data and records actualEffect/afterMetrics", async () => {
  const agent = createPpcAgent(noSetupModel);
  const output = await agent.invoke({
    task: { context: context(), payload: { action: "verify", changeLogId: "change-1", platform: "yandex-direct", externalAccountId: "login-1" } },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async (toolId, args) => {
        const a = args as { action: string };
        if (toolId === "campaign-changes" && a.action === "getCampaignChange") {
          return { expectedEffect: "+10% conversions", beforeMetrics: {}, campaignId: "123" };
        }
        if (toolId === "yandex-direct-optimize" && a.action === "getCampaignReport") return { rows: [] };
        if (toolId === "campaign-changes" && a.action === "recordVerification") return { ok: true };
        throw new Error(`unexpected call ${toolId}/${a.action}`);
      },
    },
  });

  assert.equal(output.status, "success");
  if (output.status === "success") {
    assert.match((output.result as PpcVerifyResult).actualEffect, /\+10% conversions/);
  }
});

test("trend-alerts: proposes a new campaign_changes_log row for each freshly-detected degradation", async () => {
  const proposed: unknown[] = [];
  const agent = createPpcAgent(noSetupModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: { action: "trend-alerts", clientAdAccountId: "acct-1", clientId: "client-1", platform: "google-ads" },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async (toolId, args) => {
        const a = args as { action: string };
        if (toolId === "campaign-trends" && a.action === "detectSustainedDegradation") {
          return [
            { campaignId: "123", campaignName: "Гинеколог", totalIncreasePct: 50, cpaHistory: [10, 15], weekStarts: ["2026-08-24", "2026-08-31"], hypothesis: "H", recommendation: "R" },
          ];
        }
        if (toolId === "campaign-changes" && a.action === "listCampaignChanges") return [];
        if (toolId === "campaign-changes" && a.action === "proposeCampaignChange") {
          proposed.push(args);
          return { id: "change-1" };
        }
        throw new Error(`unexpected call ${toolId}/${a.action}`);
      },
    },
  });

  assert.equal(output.status, "success");
  if (output.status === "success") {
    const result = output.result as PpcTrendAlertsResult;
    assert.equal(result.alertsFound, 1);
    assert.deepEqual(result.changeLogIds, ["change-1"]);
    assert.equal(result.skippedDuplicates, 0);
  }
  assert.equal(proposed.length, 1);
  assert.equal((proposed[0] as { changeType: string }).changeType, "trend_degradation");
});

test("trend-alerts: does not re-propose a campaign that already has an open trend_degradation change", async () => {
  const proposed: unknown[] = [];
  const agent = createPpcAgent(noSetupModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: { action: "trend-alerts", clientAdAccountId: "acct-1", clientId: "client-1", platform: "google-ads" },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async (toolId, args) => {
        const a = args as { action: string };
        if (toolId === "campaign-trends" && a.action === "detectSustainedDegradation") {
          return [{ campaignId: "123", campaignName: "Гинеколог", totalIncreasePct: 50, cpaHistory: [10, 15], weekStarts: [], hypothesis: "H", recommendation: "R" }];
        }
        if (toolId === "campaign-changes" && a.action === "listCampaignChanges") {
          return [{ campaignId: "123", changeType: "trend_degradation" }];
        }
        if (toolId === "campaign-changes" && a.action === "proposeCampaignChange") {
          proposed.push(args);
          return { id: "change-1" };
        }
        throw new Error(`unexpected call ${toolId}/${a.action}`);
      },
    },
  });

  assert.equal(output.status, "success");
  if (output.status === "success") {
    const result = output.result as PpcTrendAlertsResult;
    assert.equal(result.alertsFound, 1);
    assert.equal(result.skippedDuplicates, 1);
    assert.deepEqual(result.changeLogIds, []);
  }
  assert.equal(proposed.length, 0);
});
