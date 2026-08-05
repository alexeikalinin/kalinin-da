import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
} from "@ama/agent-framework";
import { createCopywriterAgent, type CopywriterModelCaller } from "./copywriter-agent.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("copy-task"),
    roleId: asRoleId("copywriter"),
    executionTier: "fast",
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

test("the briefs reach the model call and the draft is written to Task Memory", async () => {
  const writes: Array<[string, string, unknown]> = [];
  let seenBriefs: readonly string[] = [];
  const callModel: CopywriterModelCaller = async (_prompt, _modelId, briefs) => {
    seenBriefs = briefs;
    return { draft: { texts: ["Text 1", "Text 2"] }, decisionSummary: "Написано 2 варианта." };
  };

  const agent = createCopywriterAgent(callModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: { prompt: emptyPrompt, modelId: "x", briefs: ["short ad copy", "casual tone"] },
    },
    memory: {
      read: async () => undefined,
      write: async (level, key, value) => {
        writes.push([level, key, value]);
      },
    },
    tools: { invoke: async () => "unused" },
  });

  assert.equal(output.status, "success");
  assert.deepEqual(seenBriefs, ["short ad copy", "casual tone"]);
  assert.equal(writes[0]?.[0], "task");
  assert.equal(writes[0]?.[1], "copy-draft");
});

test("the role declares no tools (Tool Integration §2's own example)", () => {
  const agent = createCopywriterAgent(async () => {
    throw new Error("not called");
  });
  assert.deepEqual(agent.spec.toolIds, []);
});

test("a failed model call is reported as a failed Task", async () => {
  const agent = createCopywriterAgent(async () => {
    throw new Error("provider timeout");
  });
  const output = await agent.invoke({
    task: { context: context(), payload: { prompt: emptyPrompt, modelId: "x", briefs: [] } },
    memory: { read: async () => undefined, write: async () => {} },
    tools: { invoke: async () => "unused" },
  });
  assert.equal(output.status, "failed");
});
