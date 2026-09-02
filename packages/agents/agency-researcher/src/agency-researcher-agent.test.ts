import { test } from "node:test";
import assert from "node:assert/strict";
import { asProjectId, asRoleId, asTaskId, asTenantId, createInvocationContext } from "@ama/agent-framework";
import { createAgencyResearcherAgent, type AgencyResearcherModelCaller } from "./agency-researcher-agent.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("task-1"),
    roleId: asRoleId("agency-researcher"),
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

test("reads the site before searching, then records facts and moves the prospect to 'researching'", async () => {
  const toolCalls: Array<{ toolId: string; args: unknown }> = [];
  const callModel: AgencyResearcherModelCaller = async () => ({
    facts: [{ factKey: "services", factValue: "SEO, web design, Google Ads", sourceUrl: "https://abc.example", confidence: "high" }],
    decisionSummary: "SEO/web-design агентство с Google Ads как вторичной услугой.",
  });

  const agent = createAgencyResearcherAgent(callModel);
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
        if (toolId === "prospect-store") return { ok: true };
        throw new Error(`unexpected tool ${toolId}`);
      },
    },
  });

  assert.equal(output.status, "success");
  assert.deepEqual(
    toolCalls.map((c) => c.toolId),
    ["site-reader", "web-search", "prospect-store", "prospect-store"],
  );
  const statusUpdate = toolCalls.find((c) => (c.args as { action?: string }).action === "updateProspectStatus");
  assert.equal((statusUpdate?.args as { status: string }).status, "researching");
});

test("a site-reader failure is reported as a failed Task", async () => {
  const callModel: AgencyResearcherModelCaller = async () => ({ facts: [], decisionSummary: "n/a" });
  const agent = createAgencyResearcherAgent(callModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: { prompt: emptyPrompt, modelId: "x", prospectAgencyId: "prospect-1", websiteUrl: "https://abc.example" },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async () => {
        throw { code: "TOOL_ERROR", message: "unreachable site", retryable: true };
      },
    },
  });
  assert.equal(output.status, "failed");
});
