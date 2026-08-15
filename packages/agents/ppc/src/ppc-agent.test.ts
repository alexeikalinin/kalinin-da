import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
} from "@ama/agent-framework";
import { createPpcAgent, type PpcModelCaller } from "./ppc-agent.ts";

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

  const callModel: PpcModelCaller = async () => ({
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
  const callModel: PpcModelCaller = async () => {
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
  const callModel: PpcModelCaller = async () => ({
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
