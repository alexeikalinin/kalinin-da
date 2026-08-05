import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
} from "@ama/agent-framework";
import { createReportGeneratorAgent, type ReportModelCaller } from "./report-generator-agent.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("report-task"),
    roleId: asRoleId("report-generator"),
    executionTier: "standard",
    approvalLevel: "output-only",
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

// FR-6: the output only includes what was actually produced by the roles
// that actually ran — not a fixed template with empty slots.
test("only refs with real data end up in the report — a role that never ran is silently skipped", async () => {
  const available = new Map<string, unknown>([
    ["ppc-task:campaign-summary", { budgetSplit: { "google-ads": 0.6 } }],
    // no "media-buyer-task:media-budget-plan" — that role wasn't in this Project
  ]);

  const callModel: ReportModelCaller = async (_prompt, _modelId, materials) => ({
    narrativeSummary: `Included ${Object.keys(materials).length} material(s).`,
    decisionSummary: "Report assembled.",
  });

  const agent = createReportGeneratorAgent(callModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: {
        prompt: emptyPrompt,
        modelId: "x",
        materialRefs: [
          { roleId: asRoleId("ppc"), key: "ppc-task:campaign-summary" },
          { roleId: asRoleId("media-buyer"), key: "media-buyer-task:media-budget-plan" },
        ],
      },
    },
    memory: {
      read: async (_level, key) => available.get(key),
      write: async () => {},
    },
    tools: { invoke: async () => "unused" },
  });

  assert.equal(output.status, "success");
  if (output.status === "success") {
    assert.deepEqual(output.result.involvedRoles, [asRoleId("ppc")]);
    assert.equal(Object.keys(output.result.materials).length, 1);
  }
});

test("the assembled output is written back to Project Memory", async () => {
  const writes: Array<[string, string, unknown]> = [];
  const callModel: ReportModelCaller = async () => ({
    narrativeSummary: "Summary.",
    decisionSummary: "Done.",
  });

  const agent = createReportGeneratorAgent(callModel);
  await agent.invoke({
    task: { context: context(), payload: { prompt: emptyPrompt, modelId: "x", materialRefs: [] } },
    memory: {
      read: async () => undefined,
      write: async (level, key, value) => {
        writes.push([level, key, value]);
      },
    },
    tools: { invoke: async () => "unused" },
  });

  assert.equal(writes[0]?.[0], "project");
  assert.equal(writes[0]?.[1], "project-output");
});
