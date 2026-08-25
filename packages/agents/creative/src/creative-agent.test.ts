import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
} from "@ama/agent-framework";
import { createCreativeAgent, type CreativeModelCaller } from "./creative-agent.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("task-1"),
    roleId: asRoleId("creative"),
    executionTier: "standard",
    approvalLevel: "strategy-gate",
  });
}

const emptyPrompt = {
  role: "",
  task: "Баннер под летнюю распродажу.",
  clientFacts: [],
  domainKnowledge: [],
  pastExperience: [],
  projectContext: [],
  constraints: "",
};

test("a successful call invokes the creative-generation tool for every channel's brief and writes to Task Memory", async () => {
  const invoked: Array<{ toolId: string; args: unknown }> = [];
  const writes: Array<[string, string, unknown]> = [];

  const callModel: CreativeModelCaller = async (_prompt, _modelId, toolOutput) => ({
    assets: { assetRefs: [`ref-from-${JSON.stringify(toolOutput)}`], notes: "Баннер соответствует брифу." },
    decisionSummary: "Сгенерирован один баннер под google-ads.",
  });

  const agent = createCreativeAgent(callModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: {
        prompt: emptyPrompt,
        modelId: "claude-sonnet",
        creativeToolId: "creative-generation",
        channels: ["google-ads"],
      },
    },
    memory: {
      read: async () => undefined,
      write: async (level, key, value) => {
        writes.push([level, key, value]);
      },
    },
    tools: {
      invoke: async (toolId, args) => {
        invoked.push({ toolId, args });
        return { assetRefs: ["asset-1"] };
      },
    },
  });

  assert.equal(output.status, "success");
  assert.equal(invoked.length, 1);
  assert.equal(invoked[0]?.toolId, "creative-generation");
  assert.deepEqual(invoked[0]?.args, { briefText: "Баннер под летнюю распродажу.", channels: ["google-ads"] });
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.[0], "task");
  assert.equal(writes[0]?.[1], "creative-assets");
  if (output.status === "success") {
    assert.match(output.decisions[0]?.summary ?? "", /google-ads/);
  }
});

test("the role declares only the creative-generation tool (Tool Integration §2, minimal access)", () => {
  const agent = createCreativeAgent(async () => {
    throw new Error("not called in this test");
  });
  assert.deepEqual(agent.spec.toolIds, ["creative-generation"]);
});

test("a tool failure is reported as a failed Task, not thrown", async () => {
  const agent = createCreativeAgent(async () => {
    throw new Error("not called in this test");
  });
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: { prompt: emptyPrompt, modelId: "x", creativeToolId: "creative-generation", channels: ["google-ads"] },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async () => {
        throw { code: "TOOL_ERROR", message: "provider unavailable", retryable: false };
      },
    },
  });
  assert.equal(output.status, "failed");
});

test("a failed model call is reported as a failed Task", async () => {
  const agent = createCreativeAgent(async () => {
    throw new Error("provider timeout");
  });
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: { prompt: emptyPrompt, modelId: "x", creativeToolId: "creative-generation", channels: [] },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: { invoke: async () => ({}) },
  });
  assert.equal(output.status, "failed");
  if (output.status === "failed") {
    assert.equal(output.error.retryable, true);
  }
});
