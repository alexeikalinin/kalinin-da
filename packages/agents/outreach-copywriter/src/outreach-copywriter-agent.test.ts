import { test } from "node:test";
import assert from "node:assert/strict";
import { asProjectId, asRoleId, asTaskId, asTenantId, createInvocationContext } from "@ama/agent-framework";
import { createOutreachCopywriterAgent, type OutreachCopywriterModelCaller } from "./outreach-copywriter-agent.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("task-1"),
    roleId: asRoleId("outreach-copywriter"),
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

test("drafts an email and records it via prospect-store, returning its id", async () => {
  const callModel: OutreachCopywriterModelCaller = async () => ({
    subject: "Backup PPC partner for overflow work?",
    bodyText: "Hi John, I noticed ABC Digital combines SEO and paid acquisition...",
    decisionSummary: "Письмо персонализировано под SEO+PPC позиционирование агентства.",
  });

  const agent = createOutreachCopywriterAgent(callModel);
  const output = await agent.invoke({
    task: {
      context: context(),
      payload: { prompt: emptyPrompt, modelId: "claude-sonnet", prospectAgencyId: "prospect-1", decisionMakerId: "dm-1" },
    },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async (toolId, args) => {
        const a = args as { action: string };
        if (toolId !== "prospect-store") throw new Error(`unexpected tool ${toolId}`);
        if (a.action === "getResearchFacts" || a.action === "getDecisionMakers") return [];
        if (a.action === "createOutreachDraft") return { id: "msg-1" };
        throw new Error(`unexpected action ${a.action}`);
      },
    },
  });

  assert.equal(output.status, "success");
  if (output.status === "success") {
    assert.equal(output.result.outreachMessageId, "msg-1");
  }
});
