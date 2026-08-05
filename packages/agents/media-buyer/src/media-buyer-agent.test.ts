import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
} from "@ama/agent-framework";
import { createMediaBuyerAgent, type MediaBuyerModelCaller } from "./media-buyer-agent.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("task-1"),
    roleId: asRoleId("media-buyer"),
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

test("a successful plan is written to Project Memory (not Task Memory — visible to the whole Project)", async () => {
  const writes: Array<[string, string, unknown]> = [];
  const callModel: MediaBuyerModelCaller = async () => ({
    plan: { totalBudget: 1000, allocation: { "google-ads": 0.6, "vk-ads": 0.4 } },
    decisionSummary: "Общий бюджет 1000, 60% на Google Ads.",
  });

  const agent = createMediaBuyerAgent(callModel);
  const output = await agent.invoke({
    task: { context: context(), payload: { prompt: emptyPrompt, modelId: "claude-sonnet" } },
    memory: {
      read: async () => undefined,
      write: async (level, key, value) => {
        writes.push([level, key, value]);
      },
    },
    tools: { invoke: async () => "unused" },
  });

  assert.equal(output.status, "success");
  assert.equal(writes[0]?.[0], "project");
  assert.equal(writes[0]?.[1], "media-budget-plan");
});

test("the role declares no tools — it is a pure planning role (Tool Integration §2, minimal access)", () => {
  const agent = createMediaBuyerAgent(async () => {
    throw new Error("not called in this test");
  });
  assert.deepEqual(agent.spec.toolIds, []);
});

test("a failed model call is reported as a failed Task", async () => {
  const agent = createMediaBuyerAgent(async () => {
    throw new Error("provider timeout");
  });
  const output = await agent.invoke({
    task: { context: context(), payload: { prompt: emptyPrompt, modelId: "x" } },
    memory: { read: async () => undefined, write: async () => {} },
    tools: { invoke: async () => "unused" },
  });
  assert.equal(output.status, "failed");
});
