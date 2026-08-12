import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
} from "@ama/agent-framework";
import { createCeoAgent, type CeoModelCaller } from "./ceo-agent.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("ceo-task"),
    roleId: asRoleId("ceo"),
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

test("raw Project input reaches the model call and the strategy is written to Project Memory", async () => {
  let seenInput: unknown;
  const callModel: CeoModelCaller = async (_prompt, _modelId, input) => {
    seenInput = input;
    return {
      strategy: { strategySummary: "Focus on paid channels.", priorityGoals: ["increase leads"] },
      decisionSummary: "Стратегия: упор на платные каналы.",
    };
  };

  const writes: Array<[string, string, unknown]> = [];
  const agent = createCeoAgent(callModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: {
        prompt: emptyPrompt,
        modelId: "x",
        siteUrl: "https://client.example",
        businessDescription: "Running shoe retailer",
        product: "Running shoes",
        marketingTask: "Increase online sales",
      },
    },
    memory: {
      read: async () => undefined,
      write: async (level, key, value) => {
        writes.push([level, key, value]);
      },
    },
    tools: { invoke: async () => "unused" },
  });

  assert.equal(output.status, "success");
  assert.deepEqual(seenInput, {
    siteUrl: "https://client.example",
    businessDescription: "Running shoe retailer",
    product: "Running shoes",
    marketingTask: "Increase online sales",
  });
  assert.equal(writes[0]?.[0], "project");
  assert.equal(writes[0]?.[1], "strategy");
});

test("the role declares no tools — CEO only sets direction", () => {
  const agent = createCeoAgent(async () => {
    throw new Error("not called");
  });
  assert.deepEqual(agent.spec.toolIds, []);
});

test("a failed model call is reported as a failed Task", async () => {
  const agent = createCeoAgent(async () => {
    throw new Error("provider timeout");
  });
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: {
        prompt: emptyPrompt,
        modelId: "x",
        siteUrl: "https://client.example",
        businessDescription: "d",
        product: "p",
        marketingTask: "t",
      },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: { invoke: async () => "unused" },
  });
  assert.equal(output.status, "failed");
});
