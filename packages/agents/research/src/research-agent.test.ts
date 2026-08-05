import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
} from "@ama/agent-framework";
import { createResearchAgent, type ResearchModelCaller } from "./research-agent.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("research-task"),
    roleId: asRoleId("research"),
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

test("both tools are called before the model, and their output reaches the model call", async () => {
  const toolCalls: string[] = [];
  const callModel: ResearchModelCaller = async (_prompt, _modelId, siteContent, searchResults) => ({
    findings: {
      summary: "Competitor analysis complete.",
      facts: [`site: ${siteContent}`, `search: ${searchResults}`],
    },
    decisionSummary: "Собраны данные о сайте и конкурентах.",
  });

  const agent = createResearchAgent(callModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: { prompt: emptyPrompt, modelId: "x", siteUrl: "https://client.example", searchQuery: "client competitors" },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async (toolId) => {
        toolCalls.push(toolId);
        return toolId === "site-reader" ? "homepage text" : "3 competitor sites found";
      },
    },
  });

  assert.equal(output.status, "success");
  assert.deepEqual(toolCalls, ["site-reader", "web-search"]);
  if (output.status === "success") {
    assert.deepEqual(output.result.facts, ["site: homepage text", "search: 3 competitor sites found"]);
  }
});

test("if the site is unreachable, the Task fails without ever calling the model", async () => {
  let modelCalled = false;
  const callModel: ResearchModelCaller = async () => {
    modelCalled = true;
    return { findings: { summary: "", facts: [] }, decisionSummary: "" };
  };

  const agent = createResearchAgent(callModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: { prompt: emptyPrompt, modelId: "x", siteUrl: "https://unreachable.example", searchQuery: "q" },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async (toolId) => {
        if (toolId === "site-reader") {
          throw { code: "TOOL_UNAVAILABLE", message: "timeout", retryable: true };
        }
        return "unused";
      },
    },
  });

  assert.equal(output.status, "failed");
  assert.equal(modelCalled, false);
});

test("findings are written to Task Memory, ready to be archived into Project Memory for downstream roles", async () => {
  const writes: Array<[string, string, unknown]> = [];
  const callModel: ResearchModelCaller = async () => ({
    findings: { summary: "OK", facts: [] },
    decisionSummary: "OK",
  });

  const agent = createResearchAgent(callModel);
  await agent.invoke({
    task: {
      context: context(),
      payload: { prompt: emptyPrompt, modelId: "x", siteUrl: "https://client.example", searchQuery: "q" },
    },
    memory: {
      read: async () => undefined,
      write: async (level, key, value) => {
        writes.push([level, key, value]);
      },
    },
    tools: { invoke: async () => "ok" },
  });

  assert.equal(writes[0]?.[0], "task");
  assert.equal(writes[0]?.[1], "findings");
});
