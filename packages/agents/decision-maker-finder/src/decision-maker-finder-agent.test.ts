import { test } from "node:test";
import assert from "node:assert/strict";
import { asProjectId, asRoleId, asTaskId, asTenantId, createInvocationContext } from "@ama/agent-framework";
import { createDecisionMakerFinderAgent, type DecisionMakerFinderModelCaller } from "./decision-maker-finder-agent.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("task-1"),
    roleId: asRoleId("decision-maker-finder"),
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

test("records each found decision maker with an honest emailConfidence", async () => {
  const toolCalls: Array<{ toolId: string; args: unknown }> = [];
  const callModel: DecisionMakerFinderModelCaller = async () => ({
    decisionMakers: [{ fullName: "Jane Doe", title: "Founder", email: "jane@abc.example", emailConfidence: "verified", source: "team page" }],
    decisionSummary: "Founder найден на странице команды, email прямо на сайте.",
  });

  const agent = createDecisionMakerFinderAgent(callModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: { prompt: emptyPrompt, modelId: "claude-sonnet", prospectAgencyId: "prospect-1", websiteUrl: "https://abc.example" },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async (toolId, args) => {
        toolCalls.push({ toolId, args });
        if (toolId === "site-reader") return "site content";
        if (toolId === "web-search") return "search results";
        if (toolId === "prospect-store") return { id: "dm-1" };
        throw new Error(`unexpected tool ${toolId}`);
      },
    },
  });

  assert.equal(output.status, "success");
  if (output.status === "success") {
    assert.deepEqual(output.result.decisionMakerIds, ["dm-1"]);
  }
  const addCall = toolCalls.find((c) => (c.args as { action?: string }).action === "addDecisionMaker");
  assert.equal((addCall?.args as { emailConfidence: string }).emailConfidence, "verified");
});

test("no decision makers found is still a success, not a failure", async () => {
  const callModel: DecisionMakerFinderModelCaller = async () => ({ decisionMakers: [], decisionSummary: "Не найден публичный контакт." });
  const agent = createDecisionMakerFinderAgent(callModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: { prompt: emptyPrompt, modelId: "x", prospectAgencyId: "prospect-1", websiteUrl: "https://abc.example" },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: { invoke: async () => "ok" },
  });
  assert.equal(output.status, "success");
});
