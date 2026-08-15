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
import { createReportGeneratorAgent, type ReportModelCaller } from "./report-generator-agent.ts";
import { prepareReportGeneratorInvocation } from "./dispatch.ts";

// The capstone of the reference scenario built so far: a real PPC run,
// archived into Project Memory, assembled by a real Report Generator run —
// full pipeline, no shortcuts.
test("Report Generator assembles a real PPC decision into the final Project Output", async () => {
  const store = new MemoryStore();
  const registry = new ToolRegistry();
  const credentials = new CredentialStore();
  const catalog = createAnthropicModelCatalog();
  const tenantId = asTenantId("tenant-a");
  const projectId = asProjectId("project-1");
  const approver = { kind: "approver" as const, tenantId };

  registry.register(approver, { toolId: "google-ads", displayName: "Google Ads" });
  registry.register(approver, { toolId: "vk-ads", displayName: "VK Ads" });
  credentials.issue(approver, "google-ads", "token-google");
  credentials.issue(approver, "vk-ads", "token-vk");

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
    siteUrl: "https://example.com",
    complexity: "standard",
    invokeTool: async () => "configured",
  });
  const ppcOutput = await createPpcAgent(ppcCallModel).invoke(ppcInput);
  assert.equal(ppcOutput.status, "success");
  store.archiveTaskIntoProject({ kind: "agent", tenantId }, "ppc-task", projectId);

  const reportContext = createInvocationContext({
    tenantId,
    projectId,
    taskId: asTaskId("report-task"),
    roleId: asRoleId("report-generator"),
    executionTier: "standard",
    approvalLevel: "output-only",
  });

  const reportCallModel: ReportModelCaller = async (_prompt, _modelId, materials) => ({
    narrativeSummary: `Project delivered ${Object.keys(materials).length} artifact(s).`,
    decisionSummary: "Final report assembled.",
  });

  const { agentInput: reportInput } = prepareReportGeneratorInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: {
      roleId: asRoleId("report-generator"),
      version: 1,
      purpose: "Report",
      responsibility: "Report only",
    },
    context: reportContext,
    taskDescription: "Assemble the final Project Output.",
    materialRefs: [{ roleId: asRoleId("ppc"), key: "ppc-task:campaign-summary" }],
    complexity: "routine",
    invokeTool: async () => "unused",
  });

  const reportOutput = await createReportGeneratorAgent(reportCallModel).invoke(reportInput);

  assert.equal(reportOutput.status, "success");
  if (reportOutput.status === "success") {
    assert.deepEqual(reportOutput.result.involvedRoles, [asRoleId("ppc")]);
    assert.deepEqual(reportOutput.result.materials["ppc-task:campaign-summary"], {
      budgetSplit: { "google-ads": 0.6, "vk-ads": 0.4 },
    });
    assert.match(reportOutput.result.narrativeSummary, /1 artifact/);
  }
});
