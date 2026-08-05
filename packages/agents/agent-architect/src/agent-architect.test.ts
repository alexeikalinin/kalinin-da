import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
} from "@ama/agent-framework";
import { createAgentArchitect, type AgentArchitectModelCaller } from "./agent-architect.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("architect-task"),
    roleId: asRoleId("agent-architect"),
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

test("existing role ids reach the model call, so it can flag overlaps (Agent Framework §1)", async () => {
  let seenExisting: readonly ReturnType<typeof asRoleId>[] = [];
  const callModel: AgentArchitectModelCaller = async (_prompt, _modelId, roleDescription, existingRoleIds) => {
    seenExisting = existingRoleIds;
    return {
      proposal: {
        roleId: asRoleId("email-marketing"),
        displayName: "Email Marketing Agent",
        purpose: `Handle: ${roleDescription}`,
        responsibility: "Only email campaigns.",
        completionCriteria: "Draft passes QA.",
        memoryLevels: ["task", "project", "client_kb"],
        toolIds: ["email-service"],
        overlapWarnings: [],
      },
      decisionSummary: "Новая роль предложена, пересечений не найдено.",
    };
  };

  const agent = createAgentArchitect(callModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: {
        prompt: emptyPrompt,
        modelId: "x",
        roleDescription: "specialist for email marketing",
        existingRoleIds: [asRoleId("ppc"), asRoleId("copywriter")],
      },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: { invoke: async () => "unused" },
  });

  assert.equal(output.status, "success");
  assert.deepEqual(seenExisting, [asRoleId("ppc"), asRoleId("copywriter")]);
});

test("the proposal is never written to memory — it is only ever the AgentOutput.result (§4a: proposal, not activation)", async () => {
  let memoryWriteCalled = false;
  const callModel: AgentArchitectModelCaller = async () => ({
    proposal: {
      roleId: asRoleId("email-marketing"),
      displayName: "Email Marketing Agent",
      purpose: "p",
      responsibility: "r",
      completionCriteria: "c",
      memoryLevels: [],
      toolIds: [],
      overlapWarnings: [],
    },
    decisionSummary: "OK",
  });

  const agent = createAgentArchitect(callModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: { prompt: emptyPrompt, modelId: "x", roleDescription: "d", existingRoleIds: [] },
    },
    memory: {
      read: async () => undefined,
      write: async () => {
        memoryWriteCalled = true;
      },
    },
    tools: { invoke: async () => "unused" },
  });

  assert.equal(output.status, "success");
  assert.equal(memoryWriteCalled, false);
  if (output.status === "success") {
    assert.equal(output.result.roleId, "email-marketing");
  }
});

test("the role itself declares no memory levels or tools — it does nothing but propose", () => {
  const agent = createAgentArchitect(async () => {
    throw new Error("not called");
  });
  assert.deepEqual(agent.spec.memoryLevels, []);
  assert.deepEqual(agent.spec.toolIds, []);
});

test("a failed model call is reported as a failed Task", async () => {
  const agent = createAgentArchitect(async () => {
    throw new Error("provider timeout");
  });
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: { prompt: emptyPrompt, modelId: "x", roleDescription: "d", existingRoleIds: [] },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: { invoke: async () => "unused" },
  });
  assert.equal(output.status, "failed");
});
