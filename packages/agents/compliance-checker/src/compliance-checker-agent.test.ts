import { test } from "node:test";
import assert from "node:assert/strict";
import { asProjectId, asRoleId, asTaskId, asTenantId, createInvocationContext } from "@ama/agent-framework";
import { createComplianceCheckerAgent } from "./compliance-checker-agent.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("task-1"),
    roleId: asRoleId("compliance-checker"),
    executionTier: "fast",
    approvalLevel: "strategy-gate",
  });
}

const GOOD_BODY =
  "Hi John, I noticed ABC Digital combines SEO, web design and paid acquisition for local service businesses. " +
  "I work as a white-label Google Ads partner for agencies like yours — you keep the client relationship while I " +
  "handle PPC fulfillment behind the scenes, including GTM/GA4 conversion tracking. Would it be useful to have a " +
  "backup PPC partner for overflow work? Happy to share more, and totally understand if you'd rather not — just " +
  "let me know and I won't follow up. Best, Alex.";

test("a clean draft to a non-suppressed recipient moves to pending_approval", async () => {
  const statusUpdates: string[] = [];
  const agent = createComplianceCheckerAgent();
  const output = await agent.invoke({
    task: { context: context(), payload: { outreachMessageId: "msg-1" } },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async (toolId, args) => {
        const a = args as { action: string; status?: string };
        if (toolId !== "prospect-store") throw new Error(`unexpected tool ${toolId}`);
        if (a.action === "getOutreachMessage") {
          return { subject: "Backup PPC partner?", bodyText: GOOD_BODY, prospectAgencyId: "prospect-1", decisionMakerId: "dm-1" };
        }
        if (a.action === "getDecisionMakers") return [{ id: "dm-1", email: "john@abc.example" }];
        if (a.action === "isSuppressed") return { suppressed: false };
        if (a.action === "updateOutreachMessageStatus" && a.status) statusUpdates.push(a.status);
        return { ok: true };
      },
    },
  });

  assert.equal(output.status, "success");
  if (output.status === "success") {
    assert.equal(output.result.outcome, "approved");
  }
  assert.deepEqual(statusUpdates, ["pending_approval"]);
});

test("a suppressed recipient short-circuits to 'suppressed', never reaching pending_approval", async () => {
  const statusUpdates: string[] = [];
  const agent = createComplianceCheckerAgent();
  const output = await agent.invoke({
    task: { context: context(), payload: { outreachMessageId: "msg-1" } },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async (toolId, args) => {
        const a = args as { action: string; status?: string };
        if (a.action === "getOutreachMessage") {
          return { subject: "Backup PPC partner?", bodyText: GOOD_BODY, prospectAgencyId: "prospect-1", decisionMakerId: "dm-1" };
        }
        if (a.action === "getDecisionMakers") return [{ id: "dm-1", email: "removed@abc.example" }];
        if (a.action === "isSuppressed") return { suppressed: true };
        if (a.action === "updateOutreachMessageStatus" && a.status) statusUpdates.push(a.status);
        return { ok: true };
      },
    },
  });

  assert.equal(output.status, "success");
  if (output.status === "success") {
    assert.equal(output.result.outcome, "suppressed");
  }
  assert.deepEqual(statusUpdates, ["suppressed"]);
});

test("a draft with no opt-out phrasing is sent back as needs_revision, not approved", async () => {
  const agent = createComplianceCheckerAgent();
  const output = await agent.invoke({
    task: { context: context(), payload: { outreachMessageId: "msg-1" } },
    memory: { read: async () => undefined, write: async () => {} },
    tools: {
      invoke: async (_toolId, args) => {
        const a = args as { action: string };
        if (a.action === "getOutreachMessage") {
          return {
            subject: "Hi",
            bodyText: "We are a Google Ads agency and would like to offer our services to you today, please respond.",
            prospectAgencyId: "prospect-1",
            decisionMakerId: null,
          };
        }
        return { ok: true };
      },
    },
  });

  assert.equal(output.status, "needs_revision");
});
