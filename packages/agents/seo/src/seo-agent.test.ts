import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
} from "@ama/agent-framework";
import { createSeoAgent, type SeoModelCaller } from "./seo-agent.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("seo-task"),
    roleId: asRoleId("seo"),
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

test("keyword data from the SEO tool reaches the model call", async () => {
  let seenKeywordData: unknown;
  const callModel: SeoModelCaller = async (_prompt, _modelId, keywordData) => {
    seenKeywordData = keywordData;
    return {
      recommendations: { targetKeywords: ["running shoes"], recommendations: ["add meta description"] },
      decisionSummary: "Найдены ключевые слова.",
    };
  };

  const agent = createSeoAgent(callModel);
  const output = await agent.invoke({
    task: { context: context(), payload: { prompt: emptyPrompt, modelId: "x", siteUrl: "https://client.example" } },
    memory: { read: async () => undefined, write: async () => {} },
    tools: { invoke: async () => ({ positions: { "running shoes": 12 } }) },
  });

  assert.equal(output.status, "success");
  assert.deepEqual(seenKeywordData, { positions: { "running shoes": 12 } });
});

test("a tool failure is reported as a failed Task, without calling the model", async () => {
  let modelCalled = false;
  const agent = createSeoAgent(async () => {
    modelCalled = true;
    return { recommendations: { targetKeywords: [], recommendations: [] }, decisionSummary: "" };
  });
  const output = await agent.invoke({
    task: { context: context(), payload: { prompt: emptyPrompt, modelId: "x", siteUrl: "https://client.example" } },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async () => {
        throw { code: "TOOL_ERROR", message: "invalid API key", retryable: false };
      },
    },
  });
  assert.equal(output.status, "failed");
  assert.equal(modelCalled, false);
});
