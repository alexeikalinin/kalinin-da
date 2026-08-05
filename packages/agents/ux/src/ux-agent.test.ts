import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
} from "@ama/agent-framework";
import { createUxAgent, type UxModelCaller } from "./ux-agent.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("ux-task"),
    roleId: asRoleId("ux"),
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

test("the plan is written to Project Memory, not Task Memory, so UI Designer can find it", async () => {
  const writes: Array<[string, string, unknown]> = [];
  const callModel: UxModelCaller = async () => ({
    plan: { userFlows: ["browse -> product -> checkout"], structureNotes: "Simple 3-step funnel." },
    decisionSummary: "3-шаговая воронка.",
  });

  const agent = createUxAgent(callModel);
  const output = await agent.invoke({
    task: { context: context(), payload: { prompt: emptyPrompt, modelId: "x" } },
    memory: {
      read: async () => undefined,
      write: async (level, key, value) => {
        writes.push([level, key, value]);
      },
    },
    tools: { invoke: async () => "unused" },
  });

  assert.equal(output.status, "success");
  assert.equal(writes[0]?.[0], "project");
  assert.equal(writes[0]?.[1], "ux-plan");
});

test("the role declares no tools — pure planning", () => {
  const agent = createUxAgent(async () => {
    throw new Error("not called");
  });
  assert.deepEqual(agent.spec.toolIds, []);
});
