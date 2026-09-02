import { test } from "node:test";
import assert from "node:assert/strict";
import { asProjectId, asRoleId, asTaskId, asTenantId, createInvocationContext } from "@ama/agent-framework";
import { createLeadFinderAgent, type LeadFinderModelCaller } from "./lead-finder-agent.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("task-1"),
    roleId: asRoleId("lead-finder"),
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

test("searches per country, records each candidate via prospect-store, and returns their ids", async () => {
  const toolCalls: Array<{ toolId: string; args: unknown }> = [];
  const callModel: LeadFinderModelCaller = async () => ({
    candidates: [{ name: "ABC Digital", websiteUrl: "https://abcdigital.example", country: "USA", employeeCountEstimate: 8 }],
    decisionSummary: "1 кандидат найден в США.",
  });

  const agent = createLeadFinderAgent(callModel);
  const output = await agent.invoke({
    task: { context: context(), payload: { prompt: emptyPrompt, modelId: "claude-sonnet", countries: ["USA"] } },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async (toolId, args) => {
        toolCalls.push({ toolId, args });
        if (toolId === "web-search") return "search results text";
        if (toolId === "prospect-store") return { id: "prospect-1" };
        throw new Error(`unexpected tool ${toolId}`);
      },
    },
  });

  assert.equal(output.status, "success");
  if (output.status === "success") {
    assert.deepEqual(output.result.prospectAgencyIds, ["prospect-1"]);
  }
  assert.ok(toolCalls.some((c) => c.toolId === "web-search"));
  assert.ok(toolCalls.some((c) => c.toolId === "prospect-store" && (c.args as { action: string }).action === "createProspectAgency"));
});

test("a web-search tool failure is reported as a failed Task", async () => {
  const callModel: LeadFinderModelCaller = async () => ({ candidates: [], decisionSummary: "n/a" });
  const agent = createLeadFinderAgent(callModel);
  const output = await agent.invoke({
    task: { context: context(), payload: { prompt: emptyPrompt, modelId: "x", countries: ["USA"] } },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async () => {
        throw { code: "TOOL_ERROR", message: "Perplexity unavailable", retryable: true };
      },
    },
  });
  assert.equal(output.status, "failed");
});
