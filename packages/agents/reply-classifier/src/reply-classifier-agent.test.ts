import { test } from "node:test";
import assert from "node:assert/strict";
import { asProjectId, asRoleId, asTaskId, asTenantId, createInvocationContext } from "@ama/agent-framework";
import { createReplyClassifierAgent, type ReplyClassifierModelCaller } from "./reply-classifier-agent.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("task-1"),
    roleId: asRoleId("reply-classifier"),
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

test("an interested reply moves the prospect to 'replied'", async () => {
  const calls: Array<{ action: string; [key: string]: unknown }> = [];
  const callModel: ReplyClassifierModelCaller = async () => ({
    category: "interested",
    confidence: "high",
    decisionSummary: "Спрашивает про цену — заинтересован.",
  });

  const agent = createReplyClassifierAgent(callModel);
  const output = await agent.invoke({
    task: { context: context(), payload: { prompt: emptyPrompt, modelId: "claude-sonnet", outreachMessageId: "msg-1", replyText: "Sounds interesting, what's the price?" } },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async (toolId, args) => {
        const a = args as { action: string };
        calls.push({ action: a.action, ...(args as object) });
        if (toolId !== "prospect-store") throw new Error(`unexpected tool ${toolId}`);
        if (a.action === "getOutreachMessage") return { prospectAgencyId: "prospect-1" };
        return { ok: true };
      },
    },
  });

  assert.equal(output.status, "success");
  const statusUpdate = calls.find((c) => c.action === "updateProspectStatus");
  assert.equal(statusUpdate?.status, "replied");
});

test("an unsubscribe reply is recorded — suppression itself is prospect-store's job, not duplicated here", async () => {
  const calls: string[] = [];
  const callModel: ReplyClassifierModelCaller = async () => ({
    category: "unsubscribe_request",
    confidence: "high",
    decisionSummary: "Явная просьба удалить из рассылки.",
  });

  const agent = createReplyClassifierAgent(callModel);
  const output = await agent.invoke({
    task: { context: context(), payload: { prompt: emptyPrompt, modelId: "x", outreachMessageId: "msg-1", replyText: "Please remove me." } },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async (_toolId, args) => {
        calls.push((args as { action: string }).action);
        return { ok: true };
      },
    },
  });

  assert.equal(output.status, "success");
  assert.deepEqual(calls, ["recordReplyClassification"]); // no extra updateProspectStatus call for this category
});
