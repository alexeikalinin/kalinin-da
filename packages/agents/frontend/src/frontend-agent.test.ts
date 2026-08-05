import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
} from "@ama/agent-framework";
import { createFrontendAgent, type FrontendModelCaller } from "./frontend-agent.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("frontend-task"),
    roleId: asRoleId("frontend"),
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

test("the build artifact from the model reaches the deployment tool, and the URL is written to Task Memory", async () => {
  const toolCalls: unknown[] = [];
  const writes: Array<[string, string, unknown]> = [];

  const callModel: FrontendModelCaller = async (_prompt, _modelId, materials) => ({
    buildArtifact: { html: `<h1>${Object.keys(materials).length} sections</h1>` },
    decisionSummary: "Собрана статическая страница.",
  });

  const agent = createFrontendAgent(callModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: { prompt: emptyPrompt, modelId: "x", materials: { hero: "text", mockup: "ref" } },
    },
    memory: {
      read: async () => undefined,
      write: async (level, key, value) => {
        writes.push([level, key, value]);
      },
    },
    tools: {
      invoke: async (_toolId, args) => {
        toolCalls.push(args);
        return { url: "https://client-landing.example" };
      },
    },
  });

  assert.equal(output.status, "success");
  assert.deepEqual(toolCalls, [{ artifact: { html: "<h1>2 sections</h1>" } }]);
  if (output.status === "success") {
    assert.equal(output.result.deployedUrl, "https://client-landing.example");
  }
  assert.equal(writes[0]?.[0], "task");
  assert.equal(writes[0]?.[1], "deployment");
});

test("a deployment failure is reported as a failed Task, after the model already ran", async () => {
  let modelCalled = false;
  const callModel: FrontendModelCaller = async () => {
    modelCalled = true;
    return { buildArtifact: {}, decisionSummary: "" };
  };

  const agent = createFrontendAgent(callModel);
  const output = await agent.invoke({
    task: { context: context(), payload: { prompt: emptyPrompt, modelId: "x", materials: {} } },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async () => {
        throw { code: "TOOL_ERROR", message: "deploy quota exceeded", retryable: false };
      },
    },
  });

  assert.equal(output.status, "failed");
  assert.equal(modelCalled, true);
});

test("a failed model call never reaches the deployment tool", async () => {
  let toolCalled = false;
  const agent = createFrontendAgent(async () => {
    throw new Error("provider timeout");
  });
  const output = await agent.invoke({
    task: { context: context(), payload: { prompt: emptyPrompt, modelId: "x", materials: {} } },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async () => {
        toolCalled = true;
        return { url: "unused" };
      },
    },
  });
  assert.equal(output.status, "failed");
  assert.equal(toolCalled, false);
});
