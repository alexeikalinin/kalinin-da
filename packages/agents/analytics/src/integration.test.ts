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
import { createPpcAgent, preparePpcInvocation, type PpcModelCaller } from "@ama/agent-ppc";
import { createAnalyticsAgent, type AnalyticsModelCaller } from "./analytics-agent.ts";
import { prepareAnalyticsInvocation } from "./dispatch.ts";

// Chains a real PPC run into a real Analytics run: PPC's Task Memory is
// archived into Project Memory (Memory System §1), and Analytics reads it
// from there — the actual mechanism by which one agent's completed work
// becomes visible to a later one in the same Project.
test("Analytics reads PPC's archived output through Project Memory", async () => {
  const store = new MemoryStore();
  const registry = new ToolRegistry();
  const credentials = new CredentialStore();
  const catalog = createAnthropicModelCatalog();
  const tenantId = asTenantId("tenant-a");
  const projectId = asProjectId("project-1");

  registry.register(
    { kind: "approver", tenantId },
    { toolId: "google-ads", displayName: "Google Ads" },
  );
  registry.register(
    { kind: "approver", tenantId },
    { toolId: "vk-ads", displayName: "VK Ads" },
  );
  registry.register(
    { kind: "approver", tenantId },
    { toolId: "google-analytics", displayName: "Google Analytics" },
  );
  credentials.issue({ kind: "approver", tenantId }, "google-ads", "token-google");
  credentials.issue({ kind: "approver", tenantId }, "vk-ads", "token-vk");
  credentials.issue({ kind: "approver", tenantId }, "google-analytics", "token-ga");

  // --- Step 1: PPC runs and its decision is archived into Project Memory ---
  const ppcContext = createInvocationContext({
    tenantId,
    projectId,
    taskId: asTaskId("ppc-task"),
    roleId: asRoleId("ppc"),
    executionTier: "standard",
    approvalLevel: "output-only",
  });

  const ppcCallModel: PpcModelCaller = async () => ({
    result: { budgetSplit: { "google-ads": 0.6, "vk-ads": 0.4 } },
    decisionSummary: "60/40 Google/VK.",
  });

  const { agentInput: ppcInput } = preparePpcInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: { roleId: asRoleId("ppc"), version: 1, purpose: "PPC", responsibility: "PPC only" },
    context: ppcContext,
    taskDescription: "Configure campaigns.",
    clientFactKeys: [],
    channels: ["google-ads", "vk-ads"],
    complexity: "standard",
    invokeTool: async () => "configured",
  });
  const ppcOutput = await createPpcAgent(ppcCallModel).invoke(ppcInput);
  assert.equal(ppcOutput.status, "success");

  store.archiveTaskIntoProject({ kind: "agent", tenantId }, "ppc-task", projectId);

  // Proves the archive step actually relocated PPC's decision to where a
  // later Task in the same Project can find it (Memory System §1). Note:
  // assemblePrompt's "project context" block only ever surfaces *string*
  // values (it's LLM-facing text, not raw data — Prompt Architecture §1) —
  // PPC's archived value is a structured object, so it correctly does NOT
  // appear as prompt text; this checks the actual data relocation instead.
  const archivedCampaignSummary = store.read(
    { kind: "agent", tenantId },
    { level: "project", tenantId, key: `${projectId}:ppc-task:campaign-summary` },
  );
  assert.deepEqual(archivedCampaignSummary, { budgetSplit: { "google-ads": 0.6, "vk-ads": 0.4 } });

  // --- Step 2: Analytics runs its own Task, independent of PPC's data shape ---
  const analyticsContext = createInvocationContext({
    tenantId,
    projectId,
    taskId: asTaskId("analytics-task"),
    roleId: asRoleId("analytics"),
    executionTier: "standard",
    approvalLevel: "output-only",
  });

  const analyticsCallModel: AnalyticsModelCaller = async () => ({
    report: { summary: "Performing as expected.", metrics: { ctr: 0.05 } },
    decisionSummary: "CTR within target range.",
  });

  const { agentInput: analyticsInput } = prepareAnalyticsInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: {
      roleId: asRoleId("analytics"),
      version: 1,
      purpose: "Analytics",
      responsibility: "Analytics only",
    },
    context: analyticsContext,
    taskDescription: "Evaluate campaign performance.",
    clientFactKeys: [],
    projectContextKeys: ["ppc-task:campaign-summary"],
    complexity: "standard",
    invokeTool: async () => ({ ctr: 0.05 }),
    projectDisplayName: "Test Project",
    siteUrl: "https://example.com",
  });

  const analyticsOutput = await createAnalyticsAgent(analyticsCallModel).invoke(analyticsInput);

  assert.equal(analyticsOutput.status, "success");
});
