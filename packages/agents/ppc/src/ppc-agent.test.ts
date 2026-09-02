import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
} from "@ama/agent-framework";
import { createPpcAgent, type PpcApplyResult, type PpcRecommendModelCaller, type PpcRecommendResult, type PpcSetupModelCaller, type PpcVerifyResult } from "./ppc-agent.ts";

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
