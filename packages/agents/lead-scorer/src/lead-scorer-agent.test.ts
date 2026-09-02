import { test } from "node:test";
import assert from "node:assert/strict";
import { asProjectId, asRoleId, asTaskId, asTenantId, createInvocationContext } from "@ama/agent-framework";
import { createLeadScorerAgent, type LeadScorerModelCaller } from "./lead-scorer-agent.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("task-1"),
    roleId: asRoleId("lead-scorer"),
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

test("a high score marks the prospect qualified, not disqualified", async () => {
  const statusUpdates: string[] = [];
  const callModel: LeadScorerModelCaller = async () => ({
    score: 87,
    scoreBreakdown: { employeeCountFit: 15, ppcSecondaryService: 20 },
    decisionSummary: "87/100 — сильный кандидат.",
  });

  const agent = createLeadScorerAgent(callModel);
  const output = await agent.invoke({
    task: { context: context(), payload: { prompt: emptyPrompt, modelId: "claude-sonnet", prospectAgencyId: "prospect-1" } },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async (toolId, args) => {
        if (toolId === "prospect-store") {
          const a = args as { action: string; status?: string };
          if (a.action === "updateProspectStatus" && a.status) statusUpdates.push(a.status);
          if (a.action === "getResearchFacts" || a.action === "getDecisionMakers") return [];
          return { ok: true };
        }
        throw new Error(`unexpected tool ${toolId}`);
      },
    },
  });

  assert.equal(output.status, "success");
  if (output.status === "success") {
    assert.equal(output.result.disqualified, false);
  }
  assert.deepEqual(statusUpdates, ["qualified"]);
});

test("a low score disqualifies the prospect with a reason", async () => {
  const statusUpdates: Array<{ status: string; reason?: string }> = [];
  const callModel: LeadScorerModelCaller = async () => ({
    score: 25,
    scoreBreakdown: { purePpcAgency: -20 },
    decisionSummary: "25/100 — чистое PPC-агентство, низкая вероятность партнёрства.",
  });

  const agent = createLeadScorerAgent(callModel);
  const output = await agent.invoke({
    task: { context: context(), payload: { prompt: emptyPrompt, modelId: "x", prospectAgencyId: "prospect-1" } },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async (toolId, args) => {
        if (toolId === "prospect-store") {
          const a = args as { action: string; status?: string; disqualifyReason?: string };
          if (a.action === "updateProspectStatus" && a.status) statusUpdates.push({ status: a.status, reason: a.disqualifyReason });
          if (a.action === "getResearchFacts" || a.action === "getDecisionMakers") return [];
          return { ok: true };
        }
        throw new Error(`unexpected tool ${toolId}`);
      },
    },
  });

  assert.equal(output.status, "success");
  if (output.status === "success") {
    assert.equal(output.result.disqualified, true);
  }
  assert.equal(statusUpdates[0]?.status, "disqualified");
  assert.match(statusUpdates[0]?.reason ?? "", /25/);
});
