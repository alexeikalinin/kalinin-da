import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
} from "@ama/agent-framework";
import { MemoryStore } from "@ama/memory";
import { ToolRegistry, CredentialStore } from "@ama/tools";
import { createAnthropicModelCatalog } from "@ama/cost-router";
import { createResearchAgent, type ResearchModelCaller } from "./research-agent.ts";
import { prepareResearchInvocation } from "./dispatch.ts";

test("Research Agent runs end to end and its findings are archived for the rest of the Project", async () => {
  const store = new MemoryStore();
  const registry = new ToolRegistry();
  const credentials = new CredentialStore();
  const catalog = createAnthropicModelCatalog();
  const tenantId = asTenantId("tenant-a");
  const projectId = asProjectId("project-1");
  const approver = { kind: "approver" as const, tenantId };

  registry.register(approver, { toolId: "site-reader", displayName: "Site Reader" });
  registry.register(approver, { toolId: "web-search", displayName: "Web Search" });
  credentials.issue(approver, "site-reader", "n/a");
  credentials.issue(approver, "web-search", "n/a");

  const context = createInvocationContext({
    tenantId,
    projectId,
    taskId: asTaskId("research-task"),
    roleId: asRoleId("research"),
    executionTier: "standard",
    approvalLevel: "strategy-gate",
  });

  const invokeTool = async (toolId: string) =>
    toolId === "site-reader" ? "Homepage: sells running shoes." : "Competitors mostly advertise on Google Ads.";

  const callModel: ResearchModelCaller = async (_prompt, _modelId, siteContent, searchResults) => ({
    findings: {
      summary: "Running shoe retailer; competitors favor Google Ads.",
      facts: [String(siteContent), String(searchResults)],
    },
    decisionSummary: "Найдено: конкуренты преимущественно используют Google Ads.",
  });

  const { agentInput } = prepareResearchInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: {
      roleId: asRoleId("research"),
      version: 1,
      purpose: "Research",
      responsibility: "Research only",
    },
    context,
    taskDescription: "Analyze the client's site and competitors.",
    siteUrl: "https://client.example",
    searchQuery: "client competitors",
    complexity: "standard",
    invokeTool,
  });

  const output = await createResearchAgent(callModel).invoke(agentInput);
  assert.equal(output.status, "success");

  store.archiveTaskIntoProject({ kind: "agent", tenantId }, "research-task", projectId);

  const archived = store.read(
    { kind: "agent", tenantId },
    { level: "project", tenantId, key: `${projectId}:research-task:findings` },
  );
  assert.deepEqual(archived, {
    summary: "Running shoe retailer; competitors favor Google Ads.",
    facts: ["Homepage: sells running shoes.", "Competitors mostly advertise on Google Ads."],
  });
});
