import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
} from "@ama/agent-framework";
import { createQaAgent, type QaModelCaller } from "./qa-agent.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("qa-task"),
    roleId: asRoleId("qa"),
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

test("the reviewed artifact and checklist id reach the model call", async () => {
  const seen: unknown[] = [];
  const callModel: QaModelCaller = async (_prompt, _modelId, artifact, checklistId) => {
    seen.push(artifact, checklistId);
    return { verdict: { approved: true, issues: [] }, decisionSummary: "Всё в порядке." };
  };

  const agent = createQaAgent(callModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: {
        prompt: emptyPrompt,
        modelId: "x",
        artifactToReview: { budgetSplit: { "google-ads": 0.6, "vk-ads": 0.4 } },
        checklistId: "ppc-checklist",
      },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: { invoke: async () => "unused" },
  });

  assert.equal(output.status, "success");
  assert.deepEqual(seen, [{ budgetSplit: { "google-ads": 0.6, "vk-ads": 0.4 } }, "ppc-checklist"]);
});

test("QA's own Task status is success even when the verdict is 'not approved' — the reviewed artifact needs revision, not QA's own work (Workflow Engine §4)", async () => {
  const callModel: QaModelCaller = async () => ({
    verdict: { approved: false, issues: ["не хватает обоснования выбора аудитории"] },
    decisionSummary: "Требуется доработка.",
  });

  const agent = createQaAgent(callModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: { prompt: emptyPrompt, modelId: "x", artifactToReview: {}, checklistId: "c" },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: { invoke: async () => "unused" },
  });

  assert.equal(output.status, "success");
  if (output.status === "success") {
    assert.equal(output.result.approved, false);
    assert.equal(output.result.issues[0], "не хватает обоснования выбора аудитории");
  }
});

test("the verdict is written to Project Memory so Report Generator can find it later", async () => {
  const writes: Array<[string, string, unknown]> = [];
  const callModel: QaModelCaller = async () => ({
    verdict: { approved: true, issues: [] },
    decisionSummary: "OK",
  });

  const agent = createQaAgent(callModel);
  await agent.invoke({
    task: {
      context: context(),
      payload: { prompt: emptyPrompt, modelId: "x", artifactToReview: {}, checklistId: "c" },
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
  assert.equal(writes[0]?.[1], "qa-verdict");
});

test("a failed model call is reported as a failed Task", async () => {
  const agent = createQaAgent(async () => {
    throw new Error("provider timeout");
  });
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: { prompt: emptyPrompt, modelId: "x", artifactToReview: {}, checklistId: "c" },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: { invoke: async () => "unused" },
  });
  assert.equal(output.status, "failed");
});
