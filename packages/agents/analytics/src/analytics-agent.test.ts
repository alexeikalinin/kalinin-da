import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
} from "@ama/agent-framework";
import { createAnalyticsAgent, type AnalyticsModelCaller } from "./analytics-agent.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("analytics-task"),
    roleId: asRoleId("analytics"),
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

test("reads raw metrics from the analytics tool before calling the model", async () => {
  const toolCalls: string[] = [];
  const callModel: AnalyticsModelCaller = async (_prompt, _modelId, rawMetrics) => ({
    report: { summary: "OK", metrics: { ctr: (rawMetrics as { ctr: number }).ctr } },
    decisionSummary: "CTR в норме.",
  });

  const agent = createAnalyticsAgent(callModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: { prompt: emptyPrompt, modelId: "x", analyticsToolId: "google-analytics", projectDisplayName: "Test Project", siteUrl: "https://example.com" },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async (toolId) => {
        toolCalls.push(toolId);
        return { ctr: 0.045 };
      },
    },
  });

  assert.equal(output.status, "success");
  assert.deepEqual(toolCalls, ["google-analytics"]);
  if (output.status === "success") {
    assert.equal(output.result.metrics.ctr, 0.045);
  }
});

test("a tool failure fetching metrics is reported as a failed Task, without ever calling the model", async () => {
  let modelCalled = false;
  const callModel: AnalyticsModelCaller = async () => {
    modelCalled = true;
    return { report: { summary: "", metrics: {} }, decisionSummary: "" };
  };

  const agent = createAnalyticsAgent(callModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: { prompt: emptyPrompt, modelId: "x", analyticsToolId: "google-analytics", projectDisplayName: "Test Project", siteUrl: "https://example.com" },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async () => {
        throw { code: "TOOL_UNAVAILABLE", message: "timeout", retryable: true };
      },
    },
  });

  assert.equal(output.status, "failed");
  assert.equal(modelCalled, false);
});
