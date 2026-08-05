import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
} from "@ama/agent-framework";
import { createUiDesignerAgent, type UiDesignerModelCaller } from "./ui-designer-agent.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("ui-task"),
    roleId: asRoleId("ui-designer"),
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

test("the design tool is called before the model, and its output reaches the model call", async () => {
  let seenToolOutput: unknown;
  const callModel: UiDesignerModelCaller = async (_prompt, _modelId, toolOutput) => {
    seenToolOutput = toolOutput;
    return { design: { mockupRefs: ["mockup-1"], designNotes: "Clean, minimal." }, decisionSummary: "Макет создан." };
  };

  const agent = createUiDesignerAgent(callModel);
  const output = await agent.invoke({
    task: { context: context(), payload: { prompt: emptyPrompt, modelId: "x", designToolId: "design-tool" } },
    memory: { read: async () => undefined, write: async () => {} },
    tools: { invoke: async () => ({ canvasId: "abc123" }) },
  });

  assert.equal(output.status, "success");
  assert.deepEqual(seenToolOutput, { canvasId: "abc123" });
});

test("a design tool failure is reported as a failed Task", async () => {
  const agent = createUiDesignerAgent(async () => {
    throw new Error("not called");
  });
  const output = await agent.invoke({
    task: { context: context(), payload: { prompt: emptyPrompt, modelId: "x", designToolId: "design-tool" } },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async () => {
        throw { code: "TOOL_UNAVAILABLE", message: "service down", retryable: true };
      },
    },
  });
  assert.equal(output.status, "failed");
});
