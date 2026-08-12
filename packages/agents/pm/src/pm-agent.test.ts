import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
} from "@ama/agent-framework";
import { getReadyNodes, initialGraphState, withNodeState } from "@ama/workflow-engine";
import { createPmAgent, type PmModelCaller } from "./pm-agent.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("pm-task"),
    roleId: asRoleId("pm"),
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

// Workflow Engine §1's own example: "настроить рекламные кампании" ->
// Research -> PPC/Media Buyer (parallel) -> Analytics -> QA -> Report,
// no SEO/UI Designer. This is what PM Agent is actually supposed to
// produce, not something hand-written in a test.
const referenceSelection: PmModelCaller = async () => ({
  selections: [
    { taskId: "research-task", roleId: asRoleId("research"), dependsOn: [] },
    { taskId: "ppc-task", roleId: asRoleId("ppc"), dependsOn: ["research-task"] },
    { taskId: "media-buyer-task", roleId: asRoleId("media-buyer"), dependsOn: ["research-task"] },
    {
      taskId: "analytics-task",
      roleId: asRoleId("analytics"),
      dependsOn: ["ppc-task", "media-buyer-task"],
    },
    { taskId: "qa-task", roleId: asRoleId("qa"), dependsOn: ["analytics-task"] },
    { taskId: "report-task", roleId: asRoleId("report-generator"), dependsOn: ["qa-task"] },
  ],
  decisionSummary: "Задача про рекламу — SEO и UI Designer не нужны.",
});

test("a valid role selection becomes a real, usable WorkflowGraph — PPC and Media Buyer ready together", async () => {
  const agent = createPmAgent(referenceSelection);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: {
        prompt: emptyPrompt,
        modelId: "x",
        availableRoleIds: [asRoleId("research"), asRoleId("ppc"), asRoleId("media-buyer"), asRoleId("seo")],
        strategySummary: "Focus on paid ads.",
      },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: { invoke: async () => "unused" },
  });

  assert.equal(output.status, "success");
  if (output.status !== "success") return;

  assert.equal(output.result.nodes.length, 6);
  assert.ok(!output.result.nodes.some((n) => n.roleId === "seo")); // PM correctly left SEO out

  let state = initialGraphState(output.result);
  assert.deepEqual(
    getReadyNodes(output.result, state).map((n) => n.taskId),
    ["research-task"],
  );
  state = withNodeState(state, "research-task", "succeeded");
  assert.deepEqual(
    getReadyNodes(output.result, state).map((n) => n.taskId).sort(),
    ["media-buyer-task", "ppc-task"],
  );
});

test("an invalid proposal (a cycle) is a failed, retryable Task — PM's own mistake, not a systemic error", async () => {
  const cyclicSelection: PmModelCaller = async () => ({
    selections: [
      { taskId: "a", roleId: asRoleId("research"), dependsOn: ["b"] },
      { taskId: "b", roleId: asRoleId("ppc"), dependsOn: ["a"] },
    ],
    decisionSummary: "broken",
  });

  const agent = createPmAgent(cyclicSelection);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: { prompt: emptyPrompt, modelId: "x", availableRoleIds: [], strategySummary: "s" },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: { invoke: async () => "unused" },
  });

  assert.equal(output.status, "failed");
  if (output.status === "failed") {
    assert.equal(output.error.code, "INVALID_GRAPH_PROPOSAL");
    assert.equal(output.error.retryable, true);
  }
});

test("the plan summary (roles + node count) is written to Project Memory", async () => {
  const writes: Array<[string, string, unknown]> = [];
  const agent = createPmAgent(referenceSelection);
  await agent.invoke({
    task: {
      context: context(),
      payload: { prompt: emptyPrompt, modelId: "x", availableRoleIds: [], strategySummary: "s" },
    },
    memory: {
      read: async () => undefined,
      write: async (level, key, value) => {
        writes.push([level, key, value]);
      },
    },
    tools: { invoke: async () => "unused" },
  });

  assert.equal(writes[0]?.[0], "project");
  assert.equal(writes[0]?.[1], "plan");
  assert.equal((writes[0]?.[2] as { nodeCount: number }).nodeCount, 6);
});
